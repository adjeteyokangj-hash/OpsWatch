import {
  defaultAiAutomationPolicyDocument,
  POLICY_AREA_LABELS,
  type AiAutomationPolicyDocument,
  type AiOperatingProfileId
} from "./policy-document";
import { assessAiLedReadiness, type ReadinessItem } from "./enable-ai-led.service";
import { resolveProjectAutonomousModeState } from "../automation/project-autonomous-mode.service";
import { getAutoRunPolicy, type AutoRunAllowlistEntry } from "../remediation/auto-run-policy.service";
import { prisma } from "../../lib/prisma";

export type PolicyAreaTone = "green" | "amber" | "red";

export type EffectivePolicyArea = {
  id: keyof AiAutomationPolicyDocument["areas"];
  label: string;
  requested: boolean;
  effective: boolean;
  tone: PolicyAreaTone;
  source: string;
  blocker: string | null;
};

export type EffectivePolicySnapshot = {
  asOf: string;
  operatingProfile: AiOperatingProfileId;
  org: {
    requestedMode: string;
    effectiveMode: string;
    enabled: boolean;
  };
  project?: {
    projectId: string;
    requestedMode: string;
    effectiveMode: string;
    emergencyStop: boolean;
    blockedReason: string | null;
  };
  areas: EffectivePolicyArea[];
  readiness: { ready: boolean; items: ReadinessItem[] };
  allowlist: {
    enabled: boolean;
    actionCount: number;
    autoRunEnabledCount: number;
    actions: string[];
  };
  policyHealth: Array<{ id: string; label: string; ok: boolean }>;
  blocked: string[];
};

const areaTone = (requested: boolean, effective: boolean, evidenceOk: boolean): PolicyAreaTone => {
  if (!effective) return "red";
  if (requested && effective && evidenceOk) return "green";
  return "amber";
};

const resolveEffectiveAreaState = (
  areaKey: keyof AiAutomationPolicyDocument["areas"],
  document: AiAutomationPolicyDocument,
  gates: {
    orgEnabled: boolean;
    globalAutoRun: boolean;
    projectAutoRun: boolean;
    emergencyStop: boolean;
    readinessOk: boolean;
  }
): { requested: boolean; effective: boolean; source: string; blocker: string | null } => {
  const area = document.areas[areaKey];
  const requested = Boolean(area?.enabled);

  if (!gates.orgEnabled) {
    return {
      requested,
      effective: false,
      source: "organization.AutomationPolicy.GLOBAL",
      blocker: "Organization automation policy is disabled"
    };
  }

  if (gates.emergencyStop && areaKey === "autonomousExecution") {
    return {
      requested,
      effective: false,
      source: "project.remediationEmergencyDisabled",
      blocker: "Emergency stop is active on this application"
    };
  }

  if (
    areaKey === "autonomousExecution" &&
    (!gates.globalAutoRun || !gates.projectAutoRun)
  ) {
    return {
      requested,
      effective: false,
      source: "autoRemediationPolicy",
      blocker: "Auto-run policy is disabled at the org or project level"
    };
  }

  if (areaKey === "simulationReadiness" && !gates.readinessOk) {
    return {
      requested,
      effective: requested,
      source: "assessAiLedReadiness",
      blocker: "Readiness checks are not fully satisfied"
    };
  }

  return {
    requested,
    effective: requested,
    source: "aiAutomationPolicyBundle.documentJson",
    blocker: null
  };
};

export const buildEffectivePolicySnapshot = async (input: {
  organizationId: string;
  projectId?: string;
}): Promise<EffectivePolicySnapshot> => {
  const { organizationId, projectId } = input;

  const [orgPolicy, bundle, autoRunPolicy, readiness, projectState] = await Promise.all([
    prisma.automationPolicy.findUnique({
      where: {
        organizationId_policyKey: { organizationId, policyKey: "GLOBAL" }
      }
    }),
    prisma.aiAutomationPolicyBundle.findUnique({
      where: { organizationId }
    }),
    getAutoRunPolicy(organizationId),
    assessAiLedReadiness(organizationId),
    projectId
      ? resolveProjectAutonomousModeState({ organizationId, projectId })
      : Promise.resolve(null)
  ]);

  const document =
    (bundle?.documentJson as AiAutomationPolicyDocument | undefined) ??
    defaultAiAutomationPolicyDocument(
      (bundle?.operatingProfile as AiOperatingProfileId | undefined) ?? "MONITOR_ONLY"
    );

  const operatingProfile = document.areas.operatingProfile.profile;
  const orgEnabled = orgPolicy?.enabled ?? false;
  const orgRequestedMode = orgPolicy?.executionMode ?? document.areas.autonomousExecution.orgCeilingMode;
  const orgEffectiveMode = projectState?.policyGates.orgAutomationExecutionMode ?? orgRequestedMode;

  const gates = {
    orgEnabled,
    globalAutoRun: autoRunPolicy.enabled,
    projectAutoRun: projectState?.policyGates.projectAutoRunEnabled ?? autoRunPolicy.enabled,
    emergencyStop: projectState?.remediationEmergencyDisabled ?? false,
    readinessOk: readiness.ready
  };

  const areas: EffectivePolicyArea[] = (
    Object.keys(POLICY_AREA_LABELS) as Array<keyof AiAutomationPolicyDocument["areas"]>
  ).map((areaKey) => {
    const resolved = resolveEffectiveAreaState(areaKey, document, gates);
    return {
      id: areaKey,
      label: POLICY_AREA_LABELS[areaKey],
      requested: resolved.requested,
      effective: resolved.effective,
      tone: areaTone(resolved.requested, resolved.effective, readiness.ready),
      source: resolved.source,
      blocker: resolved.blocker
    };
  });

  const allowlistEntries: AutoRunAllowlistEntry[] = autoRunPolicy.allowlist ?? [];
  const autoRunEnabledCount = allowlistEntries.filter((entry: AutoRunAllowlistEntry) => entry.autoRunEnabled).length;

  const policyHealth = readiness.items.map((item: ReadinessItem) => ({
    id: item.id,
    label: item.label,
    ok: item.ok
  }));

  const blocked = [
    ...readiness.items.filter((item: ReadinessItem) => !item.ok).map((item: ReadinessItem) => item.label),
    ...(projectState?.policyGates.blockedReason ? [projectState.policyGates.blockedReason] : []),
    ...areas.filter((area) => area.blocker).map((area) => area.blocker as string)
  ].filter((value, index, array) => array.indexOf(value) === index);

  return {
    asOf: new Date().toISOString(),
    operatingProfile,
    org: {
      requestedMode: orgRequestedMode,
      effectiveMode: orgEffectiveMode,
      enabled: orgEnabled
    },
    ...(projectState && projectId
      ? {
          project: {
            projectId,
            requestedMode: projectState.requestedMode,
            effectiveMode: projectState.effectiveMode,
            emergencyStop: projectState.remediationEmergencyDisabled,
            blockedReason: projectState.policyGates.blockedReason
          }
        }
      : {}),
    areas,
    readiness,
    allowlist: {
      enabled: autoRunPolicy.enabled,
      actionCount: allowlistEntries.length,
      autoRunEnabledCount,
      actions: allowlistEntries.map((entry: AutoRunAllowlistEntry) => entry.action)
    },
    policyHealth,
    blocked
  };
};
