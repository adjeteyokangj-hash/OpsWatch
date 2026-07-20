import { randomUUID } from "crypto";
import {
  AUTONOMOUS_MODE_RANK,
  clampModeByRank,
  getAutonomousModeCapabilities,
  normalizeProjectAutonomousMode,
  type AutonomousModeCapabilities,
  type ProjectAutonomousMode
} from "@opswatch/shared";
import { prisma } from "../../lib/prisma";
import {
  clampAutomationExecutionMode,
  governanceModeCeiling,
  resolveRemediationGovernance,
  type RemediationGovernance
} from "../entitlements/remediation-governance.service";
import { getAutoRunPolicy } from "../remediation/auto-run-policy.service";

export type AutonomousModePolicyGates = {
  globalAutoRunEnabled: boolean;
  projectAutoRunEnabled: boolean;
  orgAutomationPolicyEnabled: boolean;
  orgAutomationExecutionMode: string;
  orgPolicySource: string;
  policyCentreHref: string;
  governanceTier: RemediationGovernance["tier"];
  autonomousEntitled: boolean;
  approvalEntitled: boolean;
  canEscalateToAutoHeal: boolean;
  canEscalateToFullAutonomous: boolean;
  blockedReason: string | null;
};

export type ProjectAutonomousModeState = {
  requestedMode: ProjectAutonomousMode;
  effectiveMode: ProjectAutonomousMode;
  capabilities: AutonomousModeCapabilities;
  policyGates: AutonomousModePolicyGates;
  remediationEmergencyDisabled: boolean;
};

export const resolveProjectAutonomousModeState = async (input: {
  organizationId: string;
  projectId: string;
  requestedMode?: string | null;
}): Promise<ProjectAutonomousModeState | null> => {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, organizationId: input.organizationId },
    select: {
      automationMode: true,
      remediationEmergencyDisabled: true
    }
  });
  if (!project) return null;

  const requestedMode = normalizeProjectAutonomousMode(input.requestedMode ?? project.automationMode);

  const [governance, orgPolicy, globalAutoRun] = await Promise.all([
    resolveRemediationGovernance(input.organizationId),
    prisma.automationPolicy.findUnique({
      where: {
        organizationId_policyKey: { organizationId: input.organizationId, policyKey: "GLOBAL" }
      }
    }),
    getAutoRunPolicy(input.organizationId)
  ]);

  const projectAutoRun = await prisma.autoRemediationPolicy.findFirst({
    where: {
      organizationId: input.organizationId,
      policyType: "PROJECT",
      policyKey: input.projectId
    }
  });

  const orgCeiling = await clampAutomationExecutionMode(
    input.organizationId,
    orgPolicy?.executionMode ?? "OBSERVE"
  );
  const entitlementCeiling = governanceModeCeiling(governance);

  let effectiveMode = requestedMode;
  effectiveMode = clampModeByRank(effectiveMode, orgCeiling);
  effectiveMode = clampModeByRank(effectiveMode, entitlementCeiling);

  if (project.remediationEmergencyDisabled && effectiveMode !== "DISABLED") {
    effectiveMode = clampModeByRank(effectiveMode, "MONITOR_ONLY");
  }

  const globalAutoRunEnabled = globalAutoRun.enabled;
  const projectAutoRunEnabled = projectAutoRun?.enabled ?? globalAutoRunEnabled;

  if (!globalAutoRunEnabled && effectiveMode !== "DISABLED" && effectiveMode !== "MONITOR_ONLY") {
    effectiveMode = clampModeByRank(effectiveMode, "RECOMMEND");
  }
  if (!projectAutoRunEnabled && effectiveMode !== "DISABLED" && effectiveMode !== "MONITOR_ONLY") {
    effectiveMode = clampModeByRank(effectiveMode, "RECOMMEND");
  }

  const canEscalateToAutoHeal =
    governance.approvalEnabled || governance.autonomousEnabled
      ? globalAutoRunEnabled && projectAutoRunEnabled
      : false;
  const canEscalateToFullAutonomous = governance.autonomousEnabled && globalAutoRunEnabled && projectAutoRunEnabled;

  let blockedReason: string | null = null;
  if (requestedMode !== effectiveMode) {
    if (AUTONOMOUS_MODE_RANK[requestedMode] > AUTONOMOUS_MODE_RANK[entitlementCeiling]) {
      blockedReason = `Your plan allows up to ${entitlementCeiling.replaceAll("_", " ").toLowerCase()} for this organisation.`;
    } else if (!globalAutoRunEnabled || !projectAutoRunEnabled) {
      blockedReason = "Auto-run policy is disabled at the org or project level — only monitoring and recommendations are available.";
    } else if (project.remediationEmergencyDisabled) {
      blockedReason = "Remediation emergency stop is active on this application.";
    } else {
      blockedReason = "Organisation automation policy limits the effective mode for this application.";
    }
  }

  return {
    requestedMode,
    effectiveMode,
    capabilities: getAutonomousModeCapabilities(effectiveMode),
    remediationEmergencyDisabled: project.remediationEmergencyDisabled,
    policyGates: {
      globalAutoRunEnabled,
      projectAutoRunEnabled,
      orgAutomationPolicyEnabled: orgPolicy?.enabled ?? false,
      orgAutomationExecutionMode: orgPolicy?.executionMode ?? "OBSERVE",
      orgPolicySource: "organization.AutomationPolicy.GLOBAL.executionMode",
      policyCentreHref: "/settings/ai-automation-policies",
      governanceTier: governance.tier,
      autonomousEntitled: governance.autonomousEnabled,
      approvalEntitled: governance.approvalEnabled,
      canEscalateToAutoHeal,
      canEscalateToFullAutonomous,
      blockedReason
    }
  };
};

export const updateProjectAutonomousMode = async (input: {
  organizationId: string;
  projectId: string;
  mode: string;
  updatedById?: string;
}): Promise<ProjectAutonomousModeState | null> => {
  const normalized = normalizeProjectAutonomousMode(input.mode);
  const existing = await prisma.project.findFirst({
    where: { id: input.projectId, organizationId: input.organizationId },
    select: { id: true }
  });
  if (!existing) return null;

  await prisma.project.update({
    where: { id: input.projectId },
    data: {
      automationMode: normalized,
      updatedAt: new Date()
    }
  });

  if (input.updatedById) {
    try {
      await prisma.auditLog.create({
        data: {
          id: randomUUID(),
          userId: input.updatedById,
          action: "PROJECT_AUTONOMOUS_MODE_UPDATED",
          entityType: "PROJECT",
          entityId: input.projectId,
          metadataJson: { mode: normalized } as object
        }
      });
    } catch {
      // Audit failure must not block mode update.
    }
  }

  return resolveProjectAutonomousModeState({
    organizationId: input.organizationId,
    projectId: input.projectId,
    requestedMode: normalized
  });
};

export const projectAllowsAutonomousExecution = async (input: {
  organizationId: string;
  projectId: string;
  requireFullAutonomous?: boolean;
}): Promise<{ allowed: boolean; mode: ProjectAutonomousMode; reason: string }> => {
  const state = await resolveProjectAutonomousModeState(input);
  if (!state) {
    return { allowed: false, mode: "DISABLED", reason: "Project not found" };
  }
  if (state.remediationEmergencyDisabled) {
    return { allowed: false, mode: state.effectiveMode, reason: "Remediation emergency stop is active" };
  }
  if (!state.capabilities.allowsAutoExecution) {
    return {
      allowed: false,
      mode: state.effectiveMode,
      reason: `${state.effectiveMode} does not permit automatic execution`
    };
  }
  if (input.requireFullAutonomous && state.effectiveMode !== "FULL_AUTONOMOUS") {
    return {
      allowed: false,
      mode: state.effectiveMode,
      reason: "Full autonomous execution requires FULL_AUTONOMOUS mode"
    };
  }
  return { allowed: true, mode: state.effectiveMode, reason: "Allowed" };
};
