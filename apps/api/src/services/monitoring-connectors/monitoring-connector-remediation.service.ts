import { getUniversalAction } from "../remediation/action-registry";
import { resolveActionAvailability } from "../remediation/availability.service";
import type { RemediationContext } from "../remediation/types";
import type { MonitoringConnectorMode } from "./monitoring-connector-types";

export type MonitoringRemediationProposal = {
  actionKey: string;
  displayName: string;
  riskLevel: string;
  requiresApproval: boolean;
  availabilityState: string;
  reason: string;
  autoExecute: false;
  evidenceRequirements: string[];
};

/**
 * Evidence-based remediation bridge for monitoring source alerts.
 *
 * Never auto-remediates solely because an external alert exists.
 * Requires OpsWatch diagnosis context, policy approval path, and an eligible remediator.
 */
export const proposeMonitoringRemediation = (input: {
  organizationId: string;
  projectId: string;
  connectionId: string;
  connectorMode: MonitoringConnectorMode;
  alertId?: string | null;
  incidentId?: string | null;
  operationalEntityId?: string | null;
  diagnosed: boolean;
  diagnosisSummary?: string | null;
}): MonitoringRemediationProposal[] => {
  if (!input.diagnosed) {
    return [
      {
        actionKey: "REQUEST_HUMAN_REVIEW",
        displayName: getUniversalAction("REQUEST_HUMAN_REVIEW")?.displayName ?? "Request human review",
        riskLevel: "LOW",
        requiresApproval: true,
        availabilityState: "APPROVAL_REQUIRED",
        reason:
          "External monitoring alerts alone are insufficient. OpsWatch diagnosis is required before remediation.",
        autoExecute: false,
        evidenceRequirements: ["opswatch_diagnosis", "source_evidence", "policy_approval"]
      }
    ];
  }

  const context: RemediationContext = {
    organizationId: input.organizationId,
    projectId: input.projectId,
    alertId: input.alertId ?? undefined,
    incidentId: input.incidentId ?? undefined,
    integrationId: input.connectionId,
    extra: {
      connectionId: input.connectionId,
      connectorMode: input.connectorMode,
      operationalEntityId: input.operationalEntityId ?? null,
      diagnosisSummary: input.diagnosisSummary ?? null,
      source: "EXTERNAL_MONITORING"
    }
  };

  const candidates = ["TEST_CONNECTION", "REFRESH_CONNECTION_STATUS", "OPEN_RUNBOOK", "REQUEST_HUMAN_REVIEW"] as const;
  const proposals: MonitoringRemediationProposal[] = [];

  for (const actionKey of candidates) {
    const def = getUniversalAction(actionKey);
    if (!def?.enabled) continue;
    const availability = resolveActionAvailability({
      actionKey,
      context,
      automationMode: "APPROVAL"
    });
    if (!availability) continue;
    if (availability.state === "BLOCKED" || availability.state === "NO_AUTOMATED_FIX") continue;

    proposals.push({
      actionKey,
      displayName: def.displayName,
      riskLevel: def.riskLevel,
      // Monitoring-sourced proposals always require human approval — never auto-execute.
      requiresApproval: true,
      availabilityState:
        availability.state === "READY" ? "APPROVAL_REQUIRED" : availability.state,
      reason:
        availability.reason ||
        "Eligible only after OpsWatch diagnosis, evidence review, and policy approval. Never auto-executed from an external alert alone.",
      autoExecute: false,
      evidenceRequirements: [
        "opswatch_diagnosis",
        "source_evidence",
        "policy_approval",
        ...(def.evidenceRequirements ?? [])
      ]
    });
  }

  if (proposals.length === 0) {
    proposals.push({
      actionKey: "REQUEST_HUMAN_REVIEW",
      displayName: "Request human review",
      riskLevel: "LOW",
      requiresApproval: true,
      availabilityState: "APPROVAL_REQUIRED",
      reason: "No eligible remediator is available for this monitoring signal.",
      autoExecute: false,
      evidenceRequirements: ["opswatch_diagnosis", "source_evidence", "policy_approval", "eligible_remediator"]
    });
  }

  return proposals;
};

export const assertMonitoringRemediationNotAutonomous = (
  proposals: MonitoringRemediationProposal[]
): boolean => proposals.every((row) => row.autoExecute === false && row.requiresApproval);
