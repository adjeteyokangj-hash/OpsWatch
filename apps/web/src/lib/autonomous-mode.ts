export {
  AUTONOMOUS_MODE_DESCRIPTIONS,
  AUTONOMOUS_MODE_LABELS,
  AUTONOMOUS_MODE_RANK,
  PROJECT_AUTONOMOUS_MODES,
  getAutonomousModeCapabilities,
  normalizeProjectAutonomousMode,
  type AutonomousModeCapabilities,
  type ProjectAutonomousMode
} from "@opswatch/shared";

export type ProjectAutonomousModeState = {
  requestedMode: import("@opswatch/shared").ProjectAutonomousMode;
  effectiveMode: import("@opswatch/shared").ProjectAutonomousMode;
  capabilities: import("@opswatch/shared").AutonomousModeCapabilities;
  policyGates: {
    globalAutoRunEnabled: boolean;
    projectAutoRunEnabled: boolean;
    orgAutomationPolicyEnabled: boolean;
    orgAutomationExecutionMode: string;
    governanceTier: string;
    autonomousEntitled: boolean;
    approvalEntitled: boolean;
    canEscalateToAutoHeal: boolean;
    canEscalateToFullAutonomous: boolean;
    blockedReason: string | null;
  };
  remediationEmergencyDisabled: boolean;
};
