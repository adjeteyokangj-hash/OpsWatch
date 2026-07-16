/** Project-scoped autonomous remediation mode (stored on Project.automationMode). */
export type ProjectAutonomousMode =
  | "DISABLED"
  | "MONITOR_ONLY"
  | "RECOMMEND"
  | "AUTO_HEAL_SAFE"
  | "FULL_AUTONOMOUS";

/** Legacy values persisted before the five-mode model. */
export type LegacyAutomationMode = "OBSERVE" | "APPROVAL" | "AUTONOMOUS";

export const PROJECT_AUTONOMOUS_MODES: ProjectAutonomousMode[] = [
  "DISABLED",
  "MONITOR_ONLY",
  "RECOMMEND",
  "AUTO_HEAL_SAFE",
  "FULL_AUTONOMOUS"
];

export const AUTONOMOUS_MODE_RANK: Record<ProjectAutonomousMode, number> = {
  DISABLED: 0,
  MONITOR_ONLY: 1,
  RECOMMEND: 2,
  AUTO_HEAL_SAFE: 3,
  FULL_AUTONOMOUS: 4
};

export const AUTONOMOUS_MODE_LABELS: Record<ProjectAutonomousMode, string> = {
  DISABLED: "Disabled",
  MONITOR_ONLY: "Monitor Only",
  RECOMMEND: "Recommend Fixes",
  AUTO_HEAL_SAFE: "Auto-Heal Safe Actions",
  FULL_AUTONOMOUS: "Full Autonomous"
};

export const AUTONOMOUS_MODE_DESCRIPTIONS: Record<ProjectAutonomousMode, string> = {
  DISABLED: "No automated planning or execution for this application.",
  MONITOR_ONLY: "Diagnose and surface evidence only — no repair execution.",
  RECOMMEND: "Generate remediation plans and require human approval before execution.",
  AUTO_HEAL_SAFE: "Automatically run allowlisted low-risk actions when policy permits.",
  FULL_AUTONOMOUS: "Run approved playbooks autonomously where org policy and entitlements allow."
};

export const normalizeProjectAutonomousMode = (raw: string | null | undefined): ProjectAutonomousMode => {
  const value = String(raw ?? "MONITOR_ONLY").trim().toUpperCase();
  if ((PROJECT_AUTONOMOUS_MODES as readonly string[]).includes(value)) {
    return value as ProjectAutonomousMode;
  }
  if (value === "OBSERVE") return "MONITOR_ONLY";
  if (value === "APPROVAL") return "RECOMMEND";
  if (value === "AUTONOMOUS") return "FULL_AUTONOMOUS";
  return "MONITOR_ONLY";
};

export type AutonomousModeCapabilities = {
  allowsEvaluation: boolean;
  allowsPlanning: boolean;
  allowsAutoExecution: boolean;
  requiresApprovalForExecution: boolean;
  onlyAllowlistedActions: boolean;
};

export const getAutonomousModeCapabilities = (mode: ProjectAutonomousMode): AutonomousModeCapabilities => {
  switch (mode) {
    case "DISABLED":
      return {
        allowsEvaluation: false,
        allowsPlanning: false,
        allowsAutoExecution: false,
        requiresApprovalForExecution: true,
        onlyAllowlistedActions: true
      };
    case "MONITOR_ONLY":
      return {
        allowsEvaluation: true,
        allowsPlanning: false,
        allowsAutoExecution: false,
        requiresApprovalForExecution: true,
        onlyAllowlistedActions: true
      };
    case "RECOMMEND":
      return {
        allowsEvaluation: true,
        allowsPlanning: true,
        allowsAutoExecution: false,
        requiresApprovalForExecution: true,
        onlyAllowlistedActions: true
      };
    case "AUTO_HEAL_SAFE":
      return {
        allowsEvaluation: true,
        allowsPlanning: true,
        allowsAutoExecution: true,
        requiresApprovalForExecution: false,
        onlyAllowlistedActions: true
      };
    case "FULL_AUTONOMOUS":
      return {
        allowsEvaluation: true,
        allowsPlanning: true,
        allowsAutoExecution: true,
        requiresApprovalForExecution: false,
        onlyAllowlistedActions: false
      };
    default:
      return getAutonomousModeCapabilities("MONITOR_ONLY");
  }
};

/** Map effective project mode to automation run executionMode field. */
export const toAutomationRunExecutionMode = (
  mode: ProjectAutonomousMode
): "OBSERVE" | "APPROVAL" | "AUTONOMOUS" => {
  if (mode === "FULL_AUTONOMOUS" || mode === "AUTO_HEAL_SAFE") return "AUTONOMOUS";
  if (mode === "RECOMMEND") return "APPROVAL";
  return "OBSERVE";
};

export const clampModeByRank = (
  requested: ProjectAutonomousMode,
  ceiling: ProjectAutonomousMode
): ProjectAutonomousMode => {
  return AUTONOMOUS_MODE_RANK[requested] <= AUTONOMOUS_MODE_RANK[ceiling]
    ? requested
    : ceiling;
};
