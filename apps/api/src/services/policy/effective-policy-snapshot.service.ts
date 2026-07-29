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
import {
  POLICY_AREA_REMEDIATION_ROUTES,
  type ReadinessStatus
} from "./readiness-registry";

export type PolicyAreaStatus = ReadinessStatus;

export type EffectivePolicyArea = {
  id: keyof AiAutomationPolicyDocument["areas"];
  label: string;
  requested: boolean;
  effective: boolean;
  status: PolicyAreaStatus;
  /** @deprecated use status — retained for older clients */
  tone: "green" | "amber" | "red";
  source: string;
  blocker: string | null;
  href: string | null;
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
  policyCoveragePercent: number;
  readiness: {
    ready: boolean;
    projectId: string | null;
    monitoringMode: string | null;
    capabilities: Record<string, boolean>;
    items: ReadinessItem[];
  };
  allowlist: {
    enabled: boolean;
    actionCount: number;
    autoRunEnabledCount: number;
    actions: string[];
  };
  policyHealth: Array<{ id: string; label: string; ok: boolean; status: ReadinessStatus }>;
  blocked: string[];
};

const statusToLegacyTone = (status: PolicyAreaStatus): "green" | "amber" | "red" => {
  if (status === "full") return "green";
  if (status === "not_configured") return "amber";
  return "red";
};

const resolveAreaStatus = (input: {
  requested: boolean;
  effective: boolean;
  readinessOk: boolean;
  notApplicable?: boolean;
}): PolicyAreaStatus => {
  if (input.notApplicable) return "not_applicable";
  if (!input.requested) return "disabled";
  if (input.effective && input.readinessOk) return "full";
  return "not_configured";
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
    apiDiscovered: boolean;
  }
): { requested: boolean; effective: boolean; source: string; blocker: string | null; notApplicable: boolean } => {
  const area = document.areas[areaKey];
  const requested = Boolean(area?.enabled);

  // Heartbeat-centric areas are not applicable for api-discovered apps.
  if (gates.apiDiscovered && areaKey === "simulationReadiness" && !requested) {
    return {
      requested: false,
      effective: false,
      source: "external-discovery",
      blocker: null,
      notApplicable: true
    };
  }

  if (!gates.orgEnabled) {
    return {
      requested,
      effective: false,
      source: "organization.AutomationPolicy.GLOBAL",
      blocker: "Organization automation policy is disabled",
      notApplicable: false
    };
  }

  if (gates.emergencyStop && areaKey === "autonomousExecution") {
    return {
      requested,
      effective: false,
      source: "project.remediationEmergencyDisabled",
      blocker: "Emergency stop is active on this application",
      notApplicable: false
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
      blocker: "Auto-run policy is disabled at the org or project level",
      notApplicable: false
    };
  }

  if (areaKey === "simulationReadiness" && !gates.readinessOk) {
    return {
      requested,
      effective: requested,
      source: "assessAiLedReadiness",
      blocker: "Applicable readiness checks are not fully satisfied",
      notApplicable: false
    };
  }

  return {
    requested,
    effective: requested,
    source: "aiAutomationPolicyBundle.documentJson",
    blocker: null,
    notApplicable: false
  };
};

export const buildEffectivePolicySnapshot = async (input: {
  organizationId: string;
  projectId?: string;
}): Promise<EffectivePolicySnapshot> => {
  const { organizationId } = input;

  const defaultProjectId =
    input.projectId ??
    (
      await prisma.project.findFirst({
        where: { organizationId, isActive: true },
        select: { id: true },
        orderBy: { createdAt: "asc" }
      })
    )?.id;

  const projectId = defaultProjectId;

  const emptyReadiness = {
    ready: false,
    projectId: projectId ?? null,
    monitoringMode: null as string | null,
    capabilities: {} as Record<string, boolean>,
    items: [] as ReadinessItem[]
  };

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
    projectId
      ? assessAiLedReadiness(organizationId, projectId).catch(() => emptyReadiness)
      : Promise.resolve(emptyReadiness),
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
  const apiDiscovered = readiness.monitoringMode === "api-discovered";

  const gates = {
    orgEnabled,
    globalAutoRun: autoRunPolicy.enabled,
    projectAutoRun: projectState?.policyGates.projectAutoRunEnabled ?? autoRunPolicy.enabled,
    emergencyStop: projectState?.remediationEmergencyDisabled ?? false,
    readinessOk: readiness.ready,
    apiDiscovered
  };

  const areas: EffectivePolicyArea[] = (
    Object.keys(POLICY_AREA_LABELS) as Array<keyof AiAutomationPolicyDocument["areas"]>
  ).map((areaKey) => {
    const resolved = resolveEffectiveAreaState(areaKey, document, gates);
    const status = resolveAreaStatus({
      requested: resolved.requested,
      effective: resolved.effective,
      readinessOk: readiness.ready,
      notApplicable: resolved.notApplicable
    });
    const remediation = POLICY_AREA_REMEDIATION_ROUTES[areaKey] ?? null;
    const showFix = status === "not_configured" && Boolean(remediation);
    return {
      id: areaKey,
      label: POLICY_AREA_LABELS[areaKey],
      requested: resolved.requested,
      effective: resolved.effective,
      status,
      tone: statusToLegacyTone(status),
      source: resolved.source,
      blocker: resolved.blocker,
      href: showFix ? remediation : null
    };
  });

  const covered = areas.filter((area) => area.status !== "not_configured").length;
  const policyCoveragePercent = areas.length
    ? Math.round((covered / areas.length) * 100)
    : 100;

  const allowlistEntries: AutoRunAllowlistEntry[] = autoRunPolicy.allowlist ?? [];
  const autoRunEnabledCount = allowlistEntries.filter((entry: AutoRunAllowlistEntry) => entry.autoRunEnabled).length;

  const policyHealth = readiness.items.map((item: ReadinessItem) => ({
    id: item.id,
    label: item.label,
    ok: item.ok,
    status: item.status
  }));

  const blocked = [
    ...readiness.items
      .filter((item: ReadinessItem) => item.applicable && !item.ok)
      .map((item: ReadinessItem) => item.label),
    ...(projectState?.policyGates.blockedReason ? [projectState.policyGates.blockedReason] : []),
    ...areas.filter((area) => area.blocker && area.status === "not_configured").map((area) => area.blocker as string)
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
    policyCoveragePercent,
    readiness: {
      ready: readiness.ready,
      projectId: readiness.projectId ?? projectId ?? null,
      monitoringMode: readiness.monitoringMode ?? null,
      capabilities: readiness.capabilities ?? {},
      items: readiness.items
    },
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
