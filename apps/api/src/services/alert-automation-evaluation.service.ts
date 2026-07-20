import { AlertStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { listAvailableActionsForContext, type ActionAvailabilityResult } from "./remediation/availability.service";
import { getUniversalAction } from "./remediation/action-registry";
import { diagnose } from "./ai/incident-ai.service";

export type AlertAutomationEvaluationStatus =
  | "NOT_EVALUATED"
  | "EVALUATING"
  | "NO_ACTION_AVAILABLE"
  | "CONNECTOR_REQUIRED"
  | "PERMISSION_REQUIRED"
  | "APPROVAL_REQUIRED"
  | "READY"
  | "RUNNING"
  | "VERIFYING"
  | "SUCCEEDED"
  | "FAILED"
  | "ROLLED_BACK"
  | "RECOVERED_NATURALLY"
  | "OBSERVE_ONLY"
  | "SETUP_REQUIRED"
  | "BLOCKED";

export type AlertPrimaryCtaKind =
  | "EXECUTE"
  | "CONFIGURE_CHECK"
  | "REQUEST_APPROVAL"
  | "OBSERVE_BLOCKED"
  | "SETUP_REQUIRED"
  | "NONE";

export type AlertAutomationEvaluationDto = {
  alertId: string;
  evaluationStatus: AlertAutomationEvaluationStatus;
  evaluationTimestamp: string;
  automationMode: string;
  matchingPolicy: string | null;
  availableActions: string[];
  selectedAction: string | null;
  requiredPermissions: string[];
  approvalRequired: boolean;
  reasonNoAction: string | null;
  executionStatus: string | null;
  verificationStatus: string | null;
  finalOutcome: string | null;
  recoveryTimestamp: string | null;
  autoResolutionReason: string | null;
  remediationCausedRecovery: boolean | null;
  availabilityState: string | null;
  availabilityReason: string | null;
  riskLevel: string | null;
  runId: string | null;
  correlationId: string | null;
  timeline: Array<{ stage: string; at: string | null; detail: string }>;
  failureClass: string | null;
  diagnosisSummary: string | null;
  recommendedActionLabel: string | null;
  primaryCtaKind: AlertPrimaryCtaKind;
  checkId: string | null;
  configureHref: string | null;
  projectId: string | null;
  verificationPassed: boolean;
};

/** Minimum consecutive healthy heartbeats before auto-resolve. */
export const HEARTBEAT_RECOVERY_MIN_COUNT = 3;
/** Minimum age gap (seconds) across those heartbeats for stable recovery. */
export const HEARTBEAT_RECOVERY_STABLE_SECONDS = 180;

const PRIVATE_TARGET_BLOCK =
  /local,\s*private,\s*and\s*metadata\s*targets\s*are\s*not\s*allowed|private[- ]network|metadata\s+targets?\s+are\s+not\s+allowed/i;

const NOTIFICATION_RETRY_ACTIONS = new Set(["RETRY_WEBHOOKS", "RETRY_EMAILS"]);

const mapAvailabilityToStatus = (state: string): AlertAutomationEvaluationStatus => {
  switch (state) {
    case "READY":
      return "READY";
    case "APPROVAL_REQUIRED":
      return "APPROVAL_REQUIRED";
    case "SETUP_REQUIRED":
      return "SETUP_REQUIRED";
    case "BLOCKED":
      return "BLOCKED";
    case "OBSERVE_ONLY":
      return "OBSERVE_ONLY";
    default:
      return "NO_ACTION_AVAILABLE";
  }
};

export const isPrivateTargetMonitoringBlock = (message: string | null | undefined): boolean =>
  Boolean(message && PRIVATE_TARGET_BLOCK.test(message));

const stateRank = (state: string): number => {
  switch (state) {
    case "READY":
      return 0;
    case "APPROVAL_REQUIRED":
      return 1;
    case "SETUP_REQUIRED":
      return 2;
    case "OBSERVE_ONLY":
      return 3;
    case "BLOCKED":
      return 4;
    default:
      return 5;
  }
};

export const rankAlertRemediationCandidates = (input: {
  candidates: ActionAvailabilityResult[];
  suggestedActions: string[];
  excludeNotificationRetries: boolean;
}): ActionAvailabilityResult | null => {
  let pool = input.candidates.filter((row) => row.state !== "NO_AUTOMATED_FIX");
  if (input.excludeNotificationRetries) {
    pool = pool.filter((row) => !NOTIFICATION_RETRY_ACTIONS.has(row.actionKey));
  }
  if (pool.length === 0) return null;

  const suggestionIndex = new Map(input.suggestedActions.map((key, index) => [key, index]));
  const sorted = [...pool].sort((a, b) => {
    const stateDiff = stateRank(a.state) - stateRank(b.state);
    if (stateDiff !== 0) return stateDiff;
    const ai = suggestionIndex.has(a.actionKey) ? suggestionIndex.get(a.actionKey)! : 999;
    const bi = suggestionIndex.has(b.actionKey) ? suggestionIndex.get(b.actionKey)! : 999;
    if (ai !== bi) return ai - bi;
    return a.actionKey.localeCompare(b.actionKey);
  });
  return sorted[0] ?? null;
};

const resolvePrimaryCtaKind = (input: {
  preferred: ActionAvailabilityResult | null;
  configureCheck: boolean;
}): AlertPrimaryCtaKind => {
  if (input.configureCheck) return "CONFIGURE_CHECK";
  if (!input.preferred) return "NONE";
  if (input.preferred.state === "OBSERVE_ONLY") return "OBSERVE_BLOCKED";
  if (input.preferred.state === "SETUP_REQUIRED") return "SETUP_REQUIRED";
  if (input.preferred.state === "APPROVAL_REQUIRED") return "REQUEST_APPROVAL";
  if (input.preferred.state === "READY") return "EXECUTE";
  return "NONE";
};

export const evaluateAlertAutomation = async (input: {
  alertId: string;
  organizationId: string;
}): Promise<AlertAutomationEvaluationDto> => {
  const alert = await prisma.alert.findFirst({
    where: { id: input.alertId, Project: { organizationId: input.organizationId } },
    include: {
      Project: { select: { id: true, name: true, automationMode: true } }
    }
  });

  if (!alert) {
    throw new Error("Alert not found");
  }

  const automationMode = (alert.Project.automationMode || "OBSERVE").toUpperCase();
  const now = new Date().toISOString();
  const isHeartbeat =
    alert.sourceType === "HEARTBEAT" ||
    /heartbeat/i.test(alert.title) ||
    /heartbeat/i.test(alert.message);

  const checkId =
    alert.sourceType === "CHECK" && typeof alert.sourceId === "string" && alert.sourceId
      ? alert.sourceId
      : null;

  let latestCheckResult: {
    message: string | null;
    responseCode: number | null;
    rawJson: unknown;
  } | null = null;

  if (checkId) {
    latestCheckResult = await prisma.checkResult.findFirst({
      where: { checkId },
      orderBy: { checkedAt: "desc" },
      select: { message: true, responseCode: true, rawJson: true }
    });
  }

  const rawFailureClass =
    latestCheckResult?.rawJson &&
    typeof latestCheckResult.rawJson === "object" &&
    latestCheckResult.rawJson !== null &&
    "failureClass" in (latestCheckResult.rawJson as Record<string, unknown>)
      ? String((latestCheckResult.rawJson as Record<string, unknown>).failureClass)
      : undefined;

  const configureCheck = isPrivateTargetMonitoringBlock(alert.message);
  const diagnosis = diagnose({
    alertType: alert.category || alert.sourceType,
    title: alert.title,
    message: alert.message,
    failureClass: rawFailureClass,
    actualStatusCode: latestCheckResult?.responseCode ?? undefined
  });

  const suggestedActions = configureCheck
    ? ["RERUN_HTTP_CHECK", "TEST_CONNECTION", "REQUEST_HUMAN_REVIEW"].filter((key) =>
        !NOTIFICATION_RETRY_ACTIONS.has(key)
      )
    : diagnosis.suggestedActions;

  const diagnosisSummary = configureCheck
    ? "Monitoring configuration is blocking this check: OpsWatch will not contact local, private, or metadata targets. Review the check URL or use an authorised private-network worker / public health endpoint."
    : diagnosis.diagnosis;

  const failureClass = configureCheck
    ? "MONITORING_TARGET_BLOCKED"
    : diagnosis.failureClass ?? rawFailureClass ?? null;

  const baseTimeline = [
    { stage: "Detected", at: alert.firstSeenAt.toISOString(), detail: alert.title },
    { stage: "Diagnosed", at: alert.lastSeenAt.toISOString(), detail: diagnosisSummary }
  ];

  const projectFields = {
    checkId,
    configureHref: checkId ? `/checks/${checkId}` : alert.projectId ? `/projects/${alert.projectId}/checks` : null,
    projectId: alert.projectId
  };

  const latestRun = await prisma.remediationExecutionRun.findFirst({
    where: {
      organizationId: input.organizationId,
      OR: [{ alertId: alert.id }, ...(alert.projectId ? [{ projectId: alert.projectId }] : [])]
    },
    orderBy: { createdAt: "desc" }
  });

  if (alert.status === AlertStatus.RESOLVED) {
    return {
      alertId: alert.id,
      evaluationStatus: "RECOVERED_NATURALLY",
      evaluationTimestamp: now,
      automationMode,
      matchingPolicy: isHeartbeat ? "heartbeat-recovery-verification" : null,
      availableActions: [],
      selectedAction: latestRun?.actionKey ?? null,
      requiredPermissions: [],
      approvalRequired: false,
      reasonNoAction: null,
      executionStatus: latestRun?.status ?? null,
      verificationStatus: "PASSED",
      finalOutcome: "Alert resolved after verified recovery.",
      recoveryTimestamp: alert.resolvedAt?.toISOString() ?? null,
      autoResolutionReason: "Recovery verified from returning healthy signals",
      remediationCausedRecovery: Boolean(latestRun && latestRun.status === "VERIFIED_HEALTHY"),
      availabilityState: null,
      availabilityReason: null,
      riskLevel: latestRun?.riskLevel ?? null,
      runId: latestRun?.id ?? null,
      correlationId: latestRun?.correlationId ?? null,
      timeline: [
        ...baseTimeline,
        {
          stage: "Recovered",
          at: alert.resolvedAt?.toISOString() ?? now,
          detail: "Resolved after verified recovery evidence"
        }
      ],
      failureClass,
      diagnosisSummary,
      recommendedActionLabel: null,
      primaryCtaKind: "NONE",
      ...projectFields,
      verificationPassed: true
    };
  }

  if (latestRun && ["EXECUTING", "EXECUTED", "VERIFYING"].includes(latestRun.status)) {
    return {
      alertId: alert.id,
      evaluationStatus: latestRun.status === "VERIFYING" ? "VERIFYING" : "RUNNING",
      evaluationTimestamp: now,
      automationMode,
      matchingPolicy: "phase7-execution-run",
      availableActions: [latestRun.actionKey],
      selectedAction: latestRun.actionKey,
      requiredPermissions: ["remediation:execute"],
      approvalRequired: latestRun.automationMode === "APPROVAL",
      reasonNoAction: null,
      executionStatus: latestRun.status,
      verificationStatus: latestRun.status === "VERIFYING" ? "IN_PROGRESS" : null,
      finalOutcome: null,
      recoveryTimestamp: null,
      autoResolutionReason: null,
      remediationCausedRecovery: null,
      availabilityState: "READY",
      availabilityReason: "Remediation run in progress",
      riskLevel: latestRun.riskLevel,
      runId: latestRun.id,
      correlationId: latestRun.correlationId,
      timeline: [
        ...baseTimeline,
        {
          stage: "Action executed",
          at: latestRun.startedAt?.toISOString() ?? now,
          detail: `${latestRun.actionKey} is ${latestRun.status}`
        }
      ],
      failureClass,
      diagnosisSummary,
      recommendedActionLabel: getUniversalAction(latestRun.actionKey)?.displayName ?? latestRun.actionKey,
      primaryCtaKind: "EXECUTE",
      ...projectFields,
      verificationPassed: false
    };
  }

  const connection = await prisma.connection.findFirst({
    where: { projectId: alert.projectId, organizationId: input.organizationId, isActive: true },
    select: { id: true },
    orderBy: { updatedAt: "desc" }
  });

  const candidates = listAvailableActionsForContext({
    context: {
      organizationId: input.organizationId,
      projectId: alert.projectId,
      alertId: alert.id,
      serviceId: alert.serviceId ?? undefined,
      checkId: checkId ?? undefined,
      integrationId: connection?.id,
      extra: {
        ...(connection?.id ? { connectionId: connection.id } : {}),
        ...(checkId ? { checkId } : {})
      }
    },
    automationMode,
    entityType: "ALERT"
  });

  const networkConfigClasses = new Set([
    "NETWORK_UNREACHABLE",
    "CONNECTION_REFUSED",
    "DNS_FAILURE",
    "TLS_FAILURE",
    "MONITORING_TARGET_BLOCKED"
  ]);

  const preferred = rankAlertRemediationCandidates({
    candidates,
    suggestedActions,
    excludeNotificationRetries:
      configureCheck || Boolean(failureClass && networkConfigClasses.has(failureClass))
  });

  // For private-target config issues, still exclude notification retries even if diagnosis ranked them.
  const preferredSafe =
    preferred && configureCheck && NOTIFICATION_RETRY_ACTIONS.has(preferred.actionKey)
      ? rankAlertRemediationCandidates({
          candidates,
          suggestedActions: ["RERUN_HTTP_CHECK", "TEST_CONNECTION", "REQUEST_HUMAN_REVIEW"],
          excludeNotificationRetries: true
        })
      : preferred;

  if (!preferredSafe) {
    return {
      alertId: alert.id,
      evaluationStatus: "NO_ACTION_AVAILABLE",
      evaluationTimestamp: now,
      automationMode,
      matchingPolicy: isHeartbeat ? "heartbeat-stale" : "phase7-registry",
      availableActions: [],
      selectedAction: null,
      requiredPermissions: isHeartbeat
        ? ["remediation:execute", "connector:heartbeat-worker"]
        : [],
      approvalRequired: false,
      reasonNoAction: configureCheck
        ? diagnosisSummary
        : isHeartbeat
          ? "OpsWatch detected this problem, but no approved automated repair is currently configured for heartbeat-stale without a worker remediator or heartbeat request path."
          : "No safe supported remediation action is registered for this alert.",
      executionStatus: "NOT_ATTEMPTED",
      verificationStatus: null,
      finalOutcome: null,
      recoveryTimestamp: null,
      autoResolutionReason: null,
      remediationCausedRecovery: null,
      availabilityState: "NO_AUTOMATED_FIX",
      availabilityReason: configureCheck
        ? diagnosisSummary
        : "No registry action matched this alert context",
      riskLevel: null,
      runId: latestRun?.id ?? null,
      correlationId: latestRun?.correlationId ?? null,
      timeline: baseTimeline,
      failureClass,
      diagnosisSummary,
      recommendedActionLabel: configureCheck ? "Review check configuration" : null,
      primaryCtaKind: configureCheck ? "CONFIGURE_CHECK" : "NONE",
      ...projectFields,
      verificationPassed: false
    };
  }

  const def = getUniversalAction(preferredSafe.actionKey);
  const primaryCtaKind = resolvePrimaryCtaKind({
    preferred: preferredSafe,
    configureCheck
  });

  const rankedAvailable = [...candidates]
    .filter((row) => row.state !== "NO_AUTOMATED_FIX")
    .filter((row) => !(configureCheck && NOTIFICATION_RETRY_ACTIONS.has(row.actionKey)))
    .sort((a, b) => {
      const suggestionIndex = new Map(suggestedActions.map((key, index) => [key, index]));
      const stateDiff = stateRank(a.state) - stateRank(b.state);
      if (stateDiff !== 0) return stateDiff;
      const ai = suggestionIndex.has(a.actionKey) ? suggestionIndex.get(a.actionKey)! : 999;
      const bi = suggestionIndex.has(b.actionKey) ? suggestionIndex.get(b.actionKey)! : 999;
      return ai - bi;
    })
    .map((row) => row.actionKey);

  return {
    alertId: alert.id,
    evaluationStatus: mapAvailabilityToStatus(preferredSafe.state),
    evaluationTimestamp: now,
    automationMode,
    matchingPolicy: configureCheck
      ? "monitoring-target-policy"
      : failureClass
        ? "diagnosis-ranked-registry"
        : "phase7-universal-registry",
    availableActions: rankedAvailable,
    selectedAction: preferredSafe.actionKey,
    requiredPermissions: preferredSafe.requiredScopes,
    approvalRequired: preferredSafe.state === "APPROVAL_REQUIRED" || preferredSafe.requiresApproval,
    reasonNoAction:
      preferredSafe.state === "READY" || preferredSafe.state === "APPROVAL_REQUIRED"
        ? configureCheck
          ? diagnosisSummary
          : null
        : preferredSafe.reason,
    executionStatus: latestRun?.status ?? "NOT_ATTEMPTED",
    verificationStatus: null,
    finalOutcome: null,
    recoveryTimestamp: null,
    autoResolutionReason: null,
    remediationCausedRecovery: null,
    availabilityState: preferredSafe.state,
    availabilityReason: configureCheck ? diagnosisSummary : preferredSafe.reason,
    riskLevel: preferredSafe.riskLevel,
    runId: latestRun?.id ?? null,
    correlationId: latestRun?.correlationId ?? null,
    timeline: [
      ...baseTimeline,
      {
        stage: "Action selected",
        at: now,
        detail: `${preferredSafe.displayName} → ${preferredSafe.state}: ${
          configureCheck ? "monitoring configuration review recommended" : preferredSafe.reason
        }`
      },
      {
        stage: "Verification method",
        at: null,
        detail: def?.verificationStrategy ?? "NONE"
      }
    ],
    failureClass,
    diagnosisSummary,
    recommendedActionLabel: configureCheck
      ? "Review check configuration"
      : preferredSafe.displayName,
    primaryCtaKind,
    ...projectFields,
    verificationPassed: latestRun?.status === "VERIFIED_HEALTHY"
  };
};

/**
 * When a healthy heartbeat arrives: move open heartbeat alerts to RECOVERING,
 * then resolve only after enough consecutive healthy heartbeats.
 */
export const progressHeartbeatAlertRecovery = async (projectId: string): Promise<{
  recovering: number;
  resolved: number;
}> => {
  const openStatuses = ["OPEN", "ACKNOWLEDGED", "RECOVERING", "VERIFYING", "REMEDIATING"] as AlertStatus[];
  const alerts = await prisma.alert.findMany({
    where: {
      projectId,
      sourceType: "HEARTBEAT",
      status: { in: openStatuses }
    }
  });

  if (alerts.length === 0) return { recovering: 0, resolved: 0 };

  const heartbeats = await prisma.heartbeat.findMany({
    where: { projectId, status: { not: "DOWN" } },
    orderBy: { receivedAt: "desc" },
    take: HEARTBEAT_RECOVERY_MIN_COUNT,
    select: { id: true, receivedAt: true, status: true }
  });

  const verified =
    heartbeats.length >= HEARTBEAT_RECOVERY_MIN_COUNT &&
    heartbeats.every((row) => row.status !== "DOWN") &&
    (() => {
      const newest = heartbeats[0]?.receivedAt?.getTime() ?? 0;
      const oldest = heartbeats[heartbeats.length - 1]?.receivedAt?.getTime() ?? 0;
      return newest - oldest >= HEARTBEAT_RECOVERY_STABLE_SECONDS * 1000;
    })();

  let recovering = 0;
  let resolved = 0;

  for (const alert of alerts) {
    if (verified) {
      await prisma.alert.update({
        where: { id: alert.id },
        data: {
          status: AlertStatus.RESOLVED,
          resolvedAt: new Date(),
          lastSeenAt: new Date(),
          message: `${alert.message} [auto-resolved: ${HEARTBEAT_RECOVERY_MIN_COUNT} consecutive healthy heartbeats over ≥${HEARTBEAT_RECOVERY_STABLE_SECONDS}s; remediationCausedRecovery=false]`
        }
      });
      resolved += 1;
      continue;
    }

    if (alert.status === AlertStatus.OPEN || alert.status === AlertStatus.ACKNOWLEDGED) {
      try {
        await prisma.alert.update({
          where: { id: alert.id },
          data: {
            status: "RECOVERING" as AlertStatus,
            lastSeenAt: new Date(),
            message: `${alert.message.replace(/\s*\[recovering:.*?\]/g, "")} [recovering: awaiting ${HEARTBEAT_RECOVERY_MIN_COUNT} healthy heartbeats]`
          }
        });
        recovering += 1;
      } catch {
        await prisma.alert.update({
          where: { id: alert.id },
          data: {
            lastSeenAt: new Date(),
            message: `${alert.message.replace(/\s*\[recovering:.*?\]/g, "")} [recovering: awaiting ${HEARTBEAT_RECOVERY_MIN_COUNT} healthy heartbeats]`
          }
        });
        recovering += 1;
      }
    }
  }

  return { recovering, resolved };
};
