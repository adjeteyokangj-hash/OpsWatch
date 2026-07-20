/**
 * After verified recovery, resolve contributing alerts only when recovery rules pass.
 * Keep incidents open if other contributing alerts remain.
 */
import { randomUUID } from "crypto";
import { AlertStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { redactUnknown } from "../../lib/redact-secrets";

export type RecoveryCause =
  | "automatic"
  | "administrator-approved"
  | "manual-external"
  | "natural";

export type RecoveryResolutionResult = {
  alertResolved: boolean;
  incidentResolved: boolean;
  incidentStillOpenReason: string | null;
  remainingOpenAlertCount: number | null;
  linkedAlertTotal: number | null;
  rootCauseUpdated: boolean;
};

const DEFAULT_AUTO_RESOLVE_REASON =
  "Automatically resolved after successful recovery verification";

export const applyVerifiedRecoveryResolution = async (input: {
  organizationId: string;
  projectId?: string | null;
  alertId?: string | null;
  incidentId?: string | null;
  correlationId: string;
  recoveryCause: RecoveryCause;
  verificationState: "VERIFIED_HEALTHY" | "PARTIALLY_RECOVERED" | "VERIFICATION_FAILED";
  actorUserId?: string | null;
  verificationProgress?: {
    checkId?: string;
    passed: number;
    required: number;
    met?: boolean;
  } | null;
  autoResolveReason?: string;
  rootCauseHint?: string | null;
}): Promise<RecoveryResolutionResult> => {
  const autoResolveReason = input.autoResolveReason ?? DEFAULT_AUTO_RESOLVE_REASON;

  if (input.verificationState !== "VERIFIED_HEALTHY") {
    const progressLabel = input.verificationProgress
      ? `Verification ${input.verificationProgress.passed} of ${input.verificationProgress.required} passed`
      : null;
    const summary =
      input.verificationState === "VERIFICATION_FAILED"
        ? "Verification failed — incident remains open"
        : progressLabel ?? "Partial recovery — alert kept open pending full verification";

    if (input.incidentId && input.projectId) {
      await prisma.incidentTimelineEvent.create({
        data: {
          id: randomUUID(),
          incidentId: input.incidentId,
          projectId: input.projectId,
          eventType: "REMEDIATION",
          summary,
          sourceType: "REMEDIATION_EXECUTION_RUN",
          sourceId: input.correlationId,
          payloadJson: redactUnknown({
            correlationId: input.correlationId,
            verificationState: input.verificationState,
            recoveryCause: input.recoveryCause,
            verificationProgress: input.verificationProgress ?? null
          }) as object
        }
      }).catch(() => undefined);
    }
    return {
      alertResolved: false,
      incidentResolved: false,
      incidentStillOpenReason:
        input.verificationState === "VERIFICATION_FAILED"
          ? "Verification failed — incident remains open"
          : progressLabel ?? "Only partial recovery observed",
      remainingOpenAlertCount: null,
      linkedAlertTotal: null,
      rootCauseUpdated: false
    };
  }

  let alertResolved = false;
  if (input.alertId) {
    const alert = await prisma.alert.findFirst({
      where: {
        id: input.alertId,
        Project: { organizationId: input.organizationId }
      }
    });
    if (alert && alert.status !== AlertStatus.RESOLVED) {
      const stampedMessage = `${autoResolveReason} (cause=${input.recoveryCause}; correlationId=${input.correlationId})`;
      await prisma.alert.update({
        where: { id: alert.id },
        data: {
          status: AlertStatus.RESOLVED,
          resolvedAt: new Date(),
          message: alert.message?.includes(autoResolveReason)
            ? alert.message
            : `${alert.message ? `${alert.message} — ` : ""}${stampedMessage}`
        }
      });
      alertResolved = true;
      await prisma.auditLog.create({
        data: {
          id: randomUUID(),
          userId: input.actorUserId ?? null,
          action: "ALERT_RESOLVED_AFTER_VERIFIED_RECOVERY",
          entityType: "ALERT",
          entityId: alert.id,
          metadataJson: redactUnknown({
            correlationId: input.correlationId,
            recoveryCause: input.recoveryCause,
            verificationProgress: input.verificationProgress ?? null,
            reason: autoResolveReason
          }) as object
        }
      });
    }
  }

  let incidentResolved = false;
  let incidentStillOpenReason: string | null = null;
  let remainingOpenAlertCount: number | null = null;
  let linkedAlertTotal: number | null = null;
  let rootCauseUpdated = false;

  if (input.incidentId) {
    const incident = await prisma.incident.findFirst({
      where: { id: input.incidentId, Project: { organizationId: input.organizationId } },
      include: { IncidentAlert: { include: { Alert: true } } }
    });
    if (incident) {
      linkedAlertTotal = incident.IncidentAlert.length;
      const remainingOpen = incident.IncidentAlert.filter((row) => {
        if (row.Alert.id === input.alertId && alertResolved) return false;
        return row.Alert.status !== AlertStatus.RESOLVED;
      });
      remainingOpenAlertCount = remainingOpen.length;
      const recoveredCount = linkedAlertTotal - remainingOpenAlertCount;

      if (!incident.rootCause && input.rootCauseHint?.trim()) {
        await prisma.incident.update({
          where: { id: incident.id },
          data: { rootCause: input.rootCauseHint.trim() }
        });
        rootCauseUpdated = true;
      }

      await prisma.incidentTimelineEvent.create({
        data: {
          id: randomUUID(),
          incidentId: incident.id,
          projectId: incident.projectId,
          eventType: "REMEDIATION",
          summary: alertResolved
            ? remainingOpen.length === 0
              ? "Recovery verified — incident automatically resolved"
              : `Partial recovery — ${recoveredCount} of ${linkedAlertTotal} alerts resolved`
            : "Verified recovery recorded",
          sourceType: "REMEDIATION_EXECUTION_RUN",
          sourceId: input.correlationId,
          payloadJson: redactUnknown({
            correlationId: input.correlationId,
            recoveryCause: input.recoveryCause,
            remainingOpenAlerts: remainingOpen.length,
            linkedAlertTotal,
            verificationProgress: input.verificationProgress ?? null,
            rootCauseUpdated
          }) as object
        }
      });

      if (remainingOpen.length === 0 && incident.status !== "RESOLVED") {
        await prisma.incident.update({
          where: { id: incident.id },
          data: {
            status: "RESOLVED",
            resolvedAt: new Date(),
            resolutionNotes: `${autoResolveReason} (${input.recoveryCause}); correlationId=${input.correlationId}`
          }
        });
        incidentResolved = true;
        await prisma.incidentTimelineEvent.create({
          data: {
            id: randomUUID(),
            incidentId: incident.id,
            projectId: incident.projectId,
            eventType: "INCIDENT_RESOLVED",
            summary: "Recovery verified — incident automatically resolved",
            sourceType: "REMEDIATION_EXECUTION_RUN",
            sourceId: input.correlationId,
            occurredAt: new Date()
          }
        }).catch(() => undefined);
      } else if (remainingOpen.length > 0) {
        incidentStillOpenReason = `Partial recovery — ${recoveredCount} of ${linkedAlertTotal} alerts resolved`;
      }
    }
  }

  return {
    alertResolved,
    incidentResolved,
    incidentStillOpenReason,
    remainingOpenAlertCount,
    linkedAlertTotal,
    rootCauseUpdated
  };
};
