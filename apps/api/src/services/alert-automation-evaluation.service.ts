import { AlertStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";

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
  | "RECOVERED_NATURALLY";

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
  timeline: Array<{ stage: string; at: string | null; detail: string }>;
};

/** Minimum consecutive healthy heartbeats before auto-resolve. */
export const HEARTBEAT_RECOVERY_MIN_COUNT = 3;
/** Minimum age gap (seconds) across those heartbeats for stable recovery. */
export const HEARTBEAT_RECOVERY_STABLE_SECONDS = 180;

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
    alert.sourceType === "HEARTBEAT" || /heartbeat/i.test(alert.title) || /heartbeat/i.test(alert.message);

  const baseTimeline = [
    { stage: "Detected", at: alert.firstSeenAt.toISOString(), detail: alert.title },
    { stage: "Diagnosed", at: alert.lastSeenAt.toISOString(), detail: alert.message }
  ];

  if (alert.status === AlertStatus.RESOLVED) {
    return {
      alertId: alert.id,
      evaluationStatus: "RECOVERED_NATURALLY",
      evaluationTimestamp: now,
      automationMode,
      matchingPolicy: isHeartbeat ? "heartbeat-recovery-verification" : null,
      availableActions: [],
      selectedAction: null,
      requiredPermissions: [],
      approvalRequired: false,
      reasonNoAction: null,
      executionStatus: null,
      verificationStatus: "PASSED",
      finalOutcome: "Alert resolved after verified recovery (no remediation action recorded).",
      recoveryTimestamp: alert.resolvedAt?.toISOString() ?? null,
      autoResolutionReason: "Recovery verified from returning healthy signals",
      remediationCausedRecovery: false,
      timeline: [
        ...baseTimeline,
        {
          stage: "Recovered",
          at: alert.resolvedAt?.toISOString() ?? now,
          detail: "Resolved without a recorded remediation execution"
        }
      ]
    };
  }

  if (isHeartbeat) {
    // Honest evaluation: no heartbeat restart connector is registered for project ingest.
    return {
      alertId: alert.id,
      evaluationStatus: "NO_ACTION_AVAILABLE",
      evaluationTimestamp: now,
      automationMode,
      matchingPolicy: "heartbeat-stale",
      availableActions: [],
      selectedAction: null,
      requiredPermissions: ["remediation:execute", "connector:heartbeat-worker"],
      approvalRequired: automationMode === "APPROVAL" || automationMode === "AUTONOMOUS",
      reasonNoAction:
        "OpsWatch detected this problem, but no approved automated repair is currently configured. The heartbeat is ingested via an OpsWatch API key; no connector can restart the client sender, worker, or scheduled job.",
      executionStatus: "NOT_ATTEMPTED",
      verificationStatus: alert.status === ("RECOVERING" as AlertStatus) ? "IN_PROGRESS" : null,
      finalOutcome: null,
      recoveryTimestamp: null,
      autoResolutionReason: null,
      remediationCausedRecovery: null,
      timeline: [
        ...baseTimeline,
        {
          stage: "Action selected",
          at: now,
          detail: "No safe supported remediation action is registered for heartbeat-stale"
        },
        {
          stage: "Approval",
          at: null,
          detail: "Not applicable — no action available"
        },
        {
          stage: "Action executed",
          at: null,
          detail: "Not attempted"
        },
        {
          stage: "Verification",
          at: null,
          detail:
            "When healthy heartbeats return, OpsWatch will mark RECOVERING and resolve only after consecutive successful heartbeats"
        }
      ]
    };
  }

  return {
    alertId: alert.id,
    evaluationStatus: "NO_ACTION_AVAILABLE",
    evaluationTimestamp: now,
    automationMode,
    matchingPolicy: null,
    availableActions: [],
    selectedAction: null,
    requiredPermissions: [],
    approvalRequired: false,
    reasonNoAction:
      "OpsWatch detected this problem, but no approved automated repair is currently configured for this alert type.",
    executionStatus: "NOT_ATTEMPTED",
    verificationStatus: null,
    finalOutcome: null,
    recoveryTimestamp: null,
    autoResolutionReason: null,
    remediationCausedRecovery: null,
    timeline: baseTimeline
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
      // RECOVERING may not exist until migration — fall back to OPEN with message stamp.
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
