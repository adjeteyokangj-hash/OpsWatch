/** Phase 7 universal remediation availability states (UI + API). */
export type RemediationAvailabilityState =
  | "READY"
  | "APPROVAL_REQUIRED"
  | "SETUP_REQUIRED"
  | "BLOCKED"
  | "NO_AUTOMATED_FIX"
  | "OBSERVE_ONLY";

/** Phase 7 risk classification. CRITICAL remains unsupported this phase. */
export type RemediationRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Evidence-based recovery / run lifecycle states. */
export type RemediationRecoveryState =
  | "PROPOSED"
  | "APPROVAL_PENDING"
  | "APPROVED"
  | "EXECUTING"
  | "EXECUTED"
  | "VERIFYING"
  | "VERIFIED_HEALTHY"
  | "PARTIALLY_RECOVERED"
  | "VERIFICATION_FAILED"
  | "ROLLBACK_RUNNING"
  | "ROLLED_BACK"
  | "ROLLBACK_FAILED"
  | "CANCELLED"
  | "DEAD_LETTER"
  | "BLOCKED";

export type RemediationAutomationMode = "OBSERVE" | "APPROVAL" | "AUTONOMOUS";

export type RemediationProviderKey =
  | "opswatch_native"
  | "worker_remediator"
  | "service_remediator"
  | "deployment_remediator"
  | "connection"
  | "notification"
  | "support";

export const REMEDIATION_AVAILABILITY_STATES: RemediationAvailabilityState[] = [
  "READY",
  "APPROVAL_REQUIRED",
  "SETUP_REQUIRED",
  "BLOCKED",
  "NO_AUTOMATED_FIX",
  "OBSERVE_ONLY"
];

export const REMEDIATION_RISK_LEVELS: RemediationRiskLevel[] = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL"
];

export const REMEDIATION_RECOVERY_STATES: RemediationRecoveryState[] = [
  "PROPOSED",
  "APPROVAL_PENDING",
  "APPROVED",
  "EXECUTING",
  "EXECUTED",
  "VERIFYING",
  "VERIFIED_HEALTHY",
  "PARTIALLY_RECOVERED",
  "VERIFICATION_FAILED",
  "ROLLBACK_RUNNING",
  "ROLLED_BACK",
  "ROLLBACK_FAILED",
  "CANCELLED",
  "DEAD_LETTER",
  "BLOCKED"
];

export const isCriticalRiskUnsupported = (risk: RemediationRiskLevel): boolean =>
  risk === "CRITICAL";
