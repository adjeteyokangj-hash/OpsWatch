import { entitlementFeatureDisabled } from "../../lib/entitlement-errors";
import { ENTITLEMENT_KEYS } from "./entitlement-keys";
import { isEntitlementEnabled } from "./entitlement.service";

export type RemediationGovernanceTier =
  | "MANUAL_ONLY"
  | "APPROVAL_REQUIRED"
  | "POLICY_CONTROLLED"
  | "FULLY_AUTONOMOUS";

export type RemediationGovernance = {
  tier: RemediationGovernanceTier;
  suggestedEnabled: boolean;
  approvalEnabled: boolean;
  autonomousEnabled: boolean;
};

export const resolveRemediationGovernance = async (
  organizationId: string
): Promise<RemediationGovernance> => {
  const [suggestedEnabled, approvalEnabled, autonomousEnabled] = await Promise.all([
    isEntitlementEnabled(organizationId, ENTITLEMENT_KEYS.REMEDIATION_SUGGESTED),
    isEntitlementEnabled(organizationId, ENTITLEMENT_KEYS.REMEDIATION_APPROVAL),
    isEntitlementEnabled(organizationId, ENTITLEMENT_KEYS.REMEDIATION_AUTONOMOUS)
  ]);

  let tier: RemediationGovernanceTier = "MANUAL_ONLY";
  if (autonomousEnabled) {
    tier = "FULLY_AUTONOMOUS";
  } else if (approvalEnabled) {
    tier = "POLICY_CONTROLLED";
  } else if (suggestedEnabled) {
    tier = "APPROVAL_REQUIRED";
  }

  return {
    tier,
    suggestedEnabled,
    approvalEnabled,
    autonomousEnabled
  };
};

export const assertAutonomousRemediationAllowed = async (organizationId: string): Promise<void> => {
  const governance = await resolveRemediationGovernance(organizationId);
  if (!governance.autonomousEnabled) {
    throw entitlementFeatureDisabled(ENTITLEMENT_KEYS.REMEDIATION_AUTONOMOUS);
  }
};

export const assertPolicyControlledRemediationAllowed = async (
  organizationId: string
): Promise<void> => {
  const governance = await resolveRemediationGovernance(organizationId);
  if (!governance.approvalEnabled && !governance.autonomousEnabled) {
    throw entitlementFeatureDisabled(ENTITLEMENT_KEYS.REMEDIATION_APPROVAL);
  }
};

export const clampAutomationExecutionMode = async (
  organizationId: string,
  requestedMode: "OBSERVE" | "APPROVAL" | "AUTONOMOUS"
): Promise<"OBSERVE" | "APPROVAL" | "AUTONOMOUS"> => {
  const governance = await resolveRemediationGovernance(organizationId);
  if (requestedMode === "AUTONOMOUS") {
    return governance.autonomousEnabled ? "AUTONOMOUS" : governance.approvalEnabled ? "APPROVAL" : "OBSERVE";
  }
  if (requestedMode === "APPROVAL") {
    return governance.approvalEnabled || governance.autonomousEnabled ? "APPROVAL" : "OBSERVE";
  }
  return "OBSERVE";
};
