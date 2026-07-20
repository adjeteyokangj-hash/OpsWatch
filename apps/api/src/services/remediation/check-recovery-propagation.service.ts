/**
 * Shared post-check recovery evaluation.
 * Requires Check.recoveryThreshold consecutive PASS results before
 * applyVerifiedRecoveryResolution may resolve alerts/incidents.
 */
import { randomUUID } from "crypto";
import { AlertStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { redactUnknown } from "../../lib/redact-secrets";
import { recordOperationsTimelineEvent } from "../intelligence/observation.service";
import { TIMELINE_EVENT } from "../intelligence/intelligence-constants";
import {
  applyVerifiedRecoveryResolution,
  type RecoveryCause,
  type RecoveryResolutionResult
} from "./recovery-resolution.service";

export type VerificationProgress = {
  checkId: string;
  passed: number;
  required: number;
  met: boolean;
  latestStatus: string | null;
};

export type RecoveryUiState =
  | "REPAIR_COMPLETED_VERIFICATION_PENDING"
  | "VERIFICATION_IN_PROGRESS"
  | "RECOVERY_VERIFIED"
  | "PARTIAL_RECOVERY"
  | "VERIFICATION_FAILED"
  | "VERIFICATION_RESET";

export type CheckRecoveryPropagationResult = {
  verification: VerificationProgress;
  uiState: RecoveryUiState;
  uiLabel: string;
  alertIdsConsidered: string[];
  alertResolvedIds: string[];
  incidentResolved: boolean;
  incidentStillOpenReason: string | null;
  resolvedAlertCount: number;
  remainingOpenAlertCount: number | null;
  linkedAlertTotal: number | null;
  resolution: RecoveryResolutionResult | null;
};

const AUTO_RESOLVE_REASON = "Automatically resolved after successful recovery verification";

export const evaluateCheckRecoveryThreshold = async (
  checkId: string
): Promise<VerificationProgress> => {
  const check = await prisma.check.findUnique({
    where: { id: checkId },
    select: { id: true, recoveryThreshold: true }
  });
  const required = Math.max(1, check?.recoveryThreshold ?? 2);
  const recent = await prisma.checkResult.findMany({
    where: { checkId },
    orderBy: { checkedAt: "desc" },
    take: required,
    select: { status: true }
  });

  let passed = 0;
  for (const row of recent) {
    if (row.status === "PASS") {
      passed += 1;
    } else {
      break;
    }
  }

  return {
    checkId,
    passed,
    required,
    met: passed >= required && recent.length >= required,
    latestStatus: recent[0]?.status ?? null
  };
};

const findOpenAlertsForCheck = async (input: {
  organizationId: string;
  checkId: string;
  projectId?: string | null;
  alertId?: string | null;
  incidentId?: string | null;
  serviceId?: string | null;
}) => {
  if (input.alertId) {
    const alert = await prisma.alert.findFirst({
      where: {
        id: input.alertId,
        Project: { organizationId: input.organizationId },
        status: { not: AlertStatus.RESOLVED }
      }
    });
    return alert ? [alert] : [];
  }

  const bySource = await prisma.alert.findMany({
    where: {
      sourceType: "CHECK",
      sourceId: input.checkId,
      status: { not: AlertStatus.RESOLVED },
      Project: { organizationId: input.organizationId },
      ...(input.projectId ? { projectId: input.projectId } : {})
    },
    orderBy: { lastSeenAt: "desc" }
  });
  if (bySource.length > 0) return bySource;

  if (input.incidentId) {
    const linked = await prisma.incidentAlert.findMany({
      where: {
        incidentId: input.incidentId,
        Alert: {
          status: { not: AlertStatus.RESOLVED },
          Project: { organizationId: input.organizationId },
          OR: [
            { sourceType: "CHECK", sourceId: input.checkId },
            ...(input.serviceId ? [{ serviceId: input.serviceId }] : [])
          ]
        }
      },
      include: { Alert: true }
    });
    return linked.map((row) => row.Alert);
  }

  return [];
};

const uiForProgress = (input: {
  verification: VerificationProgress;
  failed?: boolean;
  resolution?: RecoveryResolutionResult | null;
}): { uiState: RecoveryUiState; uiLabel: string } => {
  if (input.failed || input.verification.latestStatus === "FAIL") {
    return {
      uiState: "VERIFICATION_RESET",
      uiLabel: "Verification failed — incident remains open"
    };
  }
  if (!input.verification.met) {
    if (input.verification.passed === 0) {
      return {
        uiState: "REPAIR_COMPLETED_VERIFICATION_PENDING",
        uiLabel: "Repair completed — verification pending"
      };
    }
    return {
      uiState: "VERIFICATION_IN_PROGRESS",
      uiLabel: `Verification ${input.verification.passed} of ${input.verification.required} passed`
    };
  }
  if (input.resolution?.incidentResolved) {
    return {
      uiState: "RECOVERY_VERIFIED",
      uiLabel: "Recovery verified — incident automatically resolved"
    };
  }
  if (input.resolution?.incidentStillOpenReason) {
    const remaining = input.resolution.remainingOpenAlertCount;
    const total = input.resolution.linkedAlertTotal;
    if (remaining != null && total != null) {
      return {
        uiState: "PARTIAL_RECOVERY",
        uiLabel: `Partial recovery — ${total - remaining} of ${total} alerts resolved`
      };
    }
    return {
      uiState: "PARTIAL_RECOVERY",
      uiLabel: "Partial recovery — linked alerts remain"
    };
  }
  return {
    uiState: "RECOVERY_VERIFIED",
    uiLabel: "Recovery verified"
  };
};

const alreadyPropagated = async (correlationId: string, alertId: string): Promise<boolean> => {
  const recent = await prisma.auditLog.findMany({
    where: {
      action: "ALERT_RESOLVED_AFTER_VERIFIED_RECOVERY",
      entityType: "ALERT",
      entityId: alertId,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) }
    },
    select: { metadataJson: true },
    take: 20,
    orderBy: { createdAt: "desc" }
  });
  return recent.some((row) => {
    const meta = row.metadataJson as { correlationId?: string } | null;
    return meta?.correlationId === correlationId;
  });
};

export const propagateCheckRecovery = async (input: {
  organizationId: string;
  projectId?: string | null;
  checkId: string;
  alertId?: string | null;
  incidentId?: string | null;
  serviceId?: string | null;
  correlationId: string;
  recoveryCause: RecoveryCause;
  actorUserId?: string | null;
  /** When the latest check failed — reset progress messaging, never resolve. */
  checkFailed?: boolean;
  rootCauseHint?: string | null;
}): Promise<CheckRecoveryPropagationResult> => {
  const verification = await evaluateCheckRecoveryThreshold(input.checkId);

  if (input.checkFailed || verification.latestStatus === "FAIL" || verification.latestStatus === "WARN") {
    const ui = uiForProgress({ verification, failed: true });
    if (input.incidentId && input.projectId) {
      await prisma.incidentTimelineEvent.create({
        data: {
          id: randomUUID(),
          incidentId: input.incidentId,
          projectId: input.projectId,
          eventType: "REMEDIATION",
          summary: ui.uiLabel,
          sourceType: "CHECK_RECOVERY",
          sourceId: input.correlationId,
          payloadJson: redactUnknown({
            correlationId: input.correlationId,
            verification,
            checkId: input.checkId
          }) as object
        }
      }).catch(() => undefined);
    }
    return {
      verification,
      uiState: ui.uiState,
      uiLabel: ui.uiLabel,
      alertIdsConsidered: [],
      alertResolvedIds: [],
      incidentResolved: false,
      incidentStillOpenReason: "Verification failed — incident remains open",
      resolvedAlertCount: 0,
      remainingOpenAlertCount: null,
      linkedAlertTotal: null,
      resolution: null
    };
  }

  if (!verification.met) {
    const ui = uiForProgress({ verification });
    if (input.incidentId && input.projectId) {
      await applyVerifiedRecoveryResolution({
        organizationId: input.organizationId,
        projectId: input.projectId,
        alertId: input.alertId,
        incidentId: input.incidentId,
        correlationId: input.correlationId,
        recoveryCause: input.recoveryCause,
        verificationState: "PARTIALLY_RECOVERED",
        actorUserId: input.actorUserId,
        verificationProgress: verification,
        autoResolveReason: AUTO_RESOLVE_REASON
      });
    } else if (input.projectId) {
      try {
        await recordOperationsTimelineEvent({
          organizationId: input.organizationId,
          projectId: input.projectId,
          eventType: TIMELINE_EVENT.RECOVERY_VERIFIED,
          summary: ui.uiLabel,
          sourceType: "CHECK_RECOVERY",
          sourceId: input.correlationId,
          severity: "info",
          payloadJson: { verification, phase: "in_progress" }
        });
      } catch {
        /* non-fatal */
      }
    }
    return {
      verification,
      uiState: ui.uiState,
      uiLabel: ui.uiLabel,
      alertIdsConsidered: [],
      alertResolvedIds: [],
      incidentResolved: false,
      incidentStillOpenReason: ui.uiLabel,
      resolvedAlertCount: 0,
      remainingOpenAlertCount: null,
      linkedAlertTotal: null,
      resolution: null
    };
  }

  const alerts = await findOpenAlertsForCheck(input);
  const alertResolvedIds: string[] = [];
  let lastResolution: RecoveryResolutionResult | null = null;

  for (const alert of alerts) {
    if (await alreadyPropagated(input.correlationId, alert.id)) {
      continue;
    }
    lastResolution = await applyVerifiedRecoveryResolution({
      organizationId: input.organizationId,
      projectId: input.projectId ?? alert.projectId,
      alertId: alert.id,
      incidentId: input.incidentId,
      correlationId: input.correlationId,
      recoveryCause: input.recoveryCause,
      verificationState: "VERIFIED_HEALTHY",
      actorUserId: input.actorUserId,
      verificationProgress: verification,
      autoResolveReason: AUTO_RESOLVE_REASON,
      rootCauseHint: input.rootCauseHint
    });
    if (lastResolution.alertResolved) {
      alertResolvedIds.push(alert.id);
    }
  }

  // No open alerts for this check but incident may still need re-evaluation.
  if (alerts.length === 0 && input.incidentId) {
    lastResolution = await applyVerifiedRecoveryResolution({
      organizationId: input.organizationId,
      projectId: input.projectId,
      alertId: null,
      incidentId: input.incidentId,
      correlationId: input.correlationId,
      recoveryCause: input.recoveryCause,
      verificationState: "VERIFIED_HEALTHY",
      actorUserId: input.actorUserId,
      verificationProgress: verification,
      autoResolveReason: AUTO_RESOLVE_REASON,
      rootCauseHint: input.rootCauseHint
    });
  }

  if (input.projectId && alertResolvedIds.length > 0) {
    try {
      await recordOperationsTimelineEvent({
        organizationId: input.organizationId,
        projectId: input.projectId,
        eventType: TIMELINE_EVENT.RECOVERY_VERIFIED,
        summary:
          lastResolution?.incidentResolved
            ? "Recovery verified — incident automatically resolved"
            : lastResolution?.incidentStillOpenReason
              ? "Partial recovery — linked alerts remain"
              : "Recovery verified",
        sourceType: "CHECK_RECOVERY",
        sourceId: input.correlationId,
        severity: "info",
        payloadJson: redactUnknown({
          verification,
          alertResolvedIds,
          incidentResolved: lastResolution?.incidentResolved ?? false,
          incidentStillOpenReason: lastResolution?.incidentStillOpenReason ?? null
        }) as Record<string, unknown>
      });
    } catch {
      /* non-fatal */
    }
  }

  const ui = uiForProgress({ verification, resolution: lastResolution });
  return {
    verification,
    uiState: ui.uiState,
    uiLabel: ui.uiLabel,
    alertIdsConsidered: alerts.map((row) => row.id),
    alertResolvedIds,
    incidentResolved: lastResolution?.incidentResolved ?? false,
    incidentStillOpenReason: lastResolution?.incidentStillOpenReason ?? null,
    resolvedAlertCount: alertResolvedIds.length,
    remainingOpenAlertCount: lastResolution?.remainingOpenAlertCount ?? null,
    linkedAlertTotal: lastResolution?.linkedAlertTotal ?? null,
    resolution: lastResolution
  };
};
