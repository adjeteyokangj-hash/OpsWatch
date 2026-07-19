import { AlertStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { listAvailableActionsForContext } from "./remediation/availability.service";
import { getUniversalAction } from "./remediation/action-registry";

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
};

/** Minimum consecutive healthy heartbeats before auto-resolve. */
export const HEARTBEAT_RECOVERY_MIN_COUNT = 3;
/** Minimum age gap (seconds) across those heartbeats for stable recovery. */
export const HEARTBEAT_RECOVERY_STABLE_SECONDS = 180;

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

  const baseTimeline = [
    { stage: "Detected", at: alert.firstSeenAt.toISOString(), detail: alert.title },
    { stage: "Diagnosed", at: alert.lastSeenAt.toISOString(), detail: alert.message }
  ];

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
      ]
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
      ]
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
      integrationId: connection?.id,
      extra: connection?.id ? { connectionId: connection.id } : {}
    },
    automationMode,
    entityType: "ALERT"
  }).filter((row) => row.state !== "NO_AUTOMATED_FIX");

  const preferred =
    candidates.find((row) => row.state === "READY") ||
    candidates.find((row) => row.state === "APPROVAL_REQUIRED") ||
    candidates.find((row) => row.state === "SETUP_REQUIRED") ||
    candidates.find((row) => row.state === "OBSERVE_ONLY") ||
    candidates.find((row) => row.state === "BLOCKED") ||
    null;

  if (!preferred) {
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
      reasonNoAction: isHeartbeat
        ? "OpsWatch detected this problem, but no approved automated repair is currently configured for heartbeat-stale without a worker remediator or heartbeat request path."
        : "No safe supported remediation action is registered for this alert.",
      executionStatus: "NOT_ATTEMPTED",
      verificationStatus: null,
      finalOutcome: null,
      recoveryTimestamp: null,
      autoResolutionReason: null,
      remediationCausedRecovery: null,
      availabilityState: "NO_AUTOMATED_FIX",
      availabilityReason: "No registry action matched this alert context",
      riskLevel: null,
      runId: latestRun?.id ?? null,
      correlationId: latestRun?.correlationId ?? null,
      timeline: baseTimeline
    };
  }

  const def = getUniversalAction(preferred.actionKey);
  return {
    alertId: alert.id,
    evaluationStatus: mapAvailabilityToStatus(preferred.state),
    evaluationTimestamp: now,
    automationMode,
    matchingPolicy: "phase7-universal-registry",
    availableActions: candidates.map((row) => row.actionKey),
    selectedAction: preferred.actionKey,
    requiredPermissions: preferred.requiredScopes,
    approvalRequired: preferred.state === "APPROVAL_REQUIRED" || preferred.requiresApproval,
    reasonNoAction:
      preferred.state === "READY" || preferred.state === "APPROVAL_REQUIRED"
        ? null
        : preferred.reason,
    executionStatus: latestRun?.status ?? "NOT_ATTEMPTED",
    verificationStatus: null,
    finalOutcome: null,
    recoveryTimestamp: null,
    autoResolutionReason: null,
    remediationCausedRecovery: null,
    availabilityState: preferred.state,
    availabilityReason: preferred.reason,
    riskLevel: preferred.riskLevel,
    runId: latestRun?.id ?? null,
    correlationId: latestRun?.correlationId ?? null,
    timeline: [
      ...baseTimeline,
      {
        stage: "Action selected",
        at: now,
        detail: `${preferred.displayName} → ${preferred.state}: ${preferred.reason}`
      },
      {
        stage: "Verification method",
        at: null,
        detail: def?.verificationStrategy ?? "NONE"
      }
    ]
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
