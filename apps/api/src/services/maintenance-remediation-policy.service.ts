/**
 * Phase 7 maintenance-window remediation policy options.
 * Maps existing MaintenanceWindow flags (+ optional remediationPolicy column) to
 * ALLOW_LOW_RISK | REQUIRE_APPROVAL | SUPPRESS | DEFER | EMERGENCY_ONLY.
 */
import type { MaintenancePolicyResult } from "./maintenance-window-policy.service";
import { findActiveMaintenanceForService } from "./maintenance-window-policy.service";
import type { RemediationRiskLevel } from "./remediation/action-registry";

export type MaintenanceRemediationBehaviour =
  | "ALLOW_LOW_RISK"
  | "REQUIRE_APPROVAL"
  | "SUPPRESS"
  | "DEFER"
  | "EMERGENCY_ONLY"
  | "NONE";

export type MaintenanceRemediationDecision = {
  inMaintenance: boolean;
  behaviour: MaintenanceRemediationBehaviour;
  windowId?: string;
  windowName?: string;
  allowed: boolean;
  reason: string;
  /** Deferred actions must not auto-execute after the window without revalidation. */
  deferUntil?: string;
};

/**
 * Derive Phase 7 behaviour from persisted window flags.
 * - allowAutonomous=true → ALLOW_LOW_RISK
 * - suppressAlerts without autonomous → SUPPRESS (default safe)
 * - otherwise REQUIRE_APPROVAL
 * Optional explicit remediationPolicy on the window overrides derivation when present.
 */
export const deriveMaintenanceRemediationBehaviour = (
  policy: MaintenancePolicyResult & { remediationPolicy?: string | null }
): MaintenanceRemediationBehaviour => {
  if (!policy.inMaintenance) return "NONE";
  const explicit = String(policy.remediationPolicy || "")
    .trim()
    .toUpperCase();
  if (
    explicit === "ALLOW_LOW_RISK" ||
    explicit === "REQUIRE_APPROVAL" ||
    explicit === "SUPPRESS" ||
    explicit === "DEFER" ||
    explicit === "EMERGENCY_ONLY"
  ) {
    return explicit;
  }
  if (policy.allowAutonomous) return "ALLOW_LOW_RISK";
  if (policy.suppressAlerts || policy.suppressIncidents) return "SUPPRESS";
  return "REQUIRE_APPROVAL";
};

export const evaluateMaintenanceRemediation = async (input: {
  organizationId: string;
  projectId: string;
  serviceId?: string | null;
  riskLevel: RemediationRiskLevel | string;
  automationMode: "OBSERVE" | "APPROVAL" | "AUTONOMOUS";
  emergency?: boolean;
  at?: Date;
}): Promise<MaintenanceRemediationDecision> => {
  const policy = await findActiveMaintenanceForService({
    organizationId: input.organizationId,
    projectId: input.projectId,
    serviceId: input.serviceId,
    at: input.at
  });

  if (!policy.inMaintenance) {
    return {
      inMaintenance: false,
      behaviour: "NONE",
      allowed: true,
      reason: "No active maintenance window"
    };
  }

  const behaviour = deriveMaintenanceRemediationBehaviour(policy);
  const base = {
    inMaintenance: true,
    behaviour,
    windowId: policy.windowId,
    windowName: policy.windowName
  };

  switch (behaviour) {
    case "SUPPRESS":
      return {
        ...base,
        allowed: false,
        reason: `Maintenance window "${policy.windowName}" suppresses remediation execution`
      };
    case "DEFER":
      return {
        ...base,
        allowed: false,
        reason: `Maintenance window "${policy.windowName}" defers remediation until the window ends — revalidate evidence before executing`,
        deferUntil: undefined
      };
    case "EMERGENCY_ONLY":
      if (input.emergency) {
        return {
          ...base,
          allowed: true,
          reason: `Emergency action permitted during maintenance window "${policy.windowName}"`
        };
      }
      return {
        ...base,
        allowed: false,
        reason: `Maintenance window "${policy.windowName}" permits emergency actions only`
      };
    case "ALLOW_LOW_RISK":
      if (String(input.riskLevel).toUpperCase() === "LOW") {
        return {
          ...base,
          allowed: true,
          reason: `Low-risk action allowed during maintenance window "${policy.windowName}"`
        };
      }
      if (input.automationMode === "APPROVAL") {
        return {
          ...base,
          allowed: true,
          reason: `Non-low-risk action may proceed with approval during maintenance window "${policy.windowName}"`
        };
      }
      return {
        ...base,
        allowed: false,
        reason: `Only low-risk autonomous actions are allowed during maintenance window "${policy.windowName}"`
      };
    case "REQUIRE_APPROVAL":
      if (input.automationMode === "APPROVAL") {
        return {
          ...base,
          allowed: true,
          reason: `Approval required during maintenance window "${policy.windowName}"`
        };
      }
      return {
        ...base,
        allowed: false,
        reason: `Autonomous execution blocked during maintenance window "${policy.windowName}" — approval required`
      };
    default:
      return {
        ...base,
        allowed: true,
        reason: "Maintenance policy allows execution"
      };
  }
};
