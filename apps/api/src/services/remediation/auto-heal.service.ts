import { prisma } from "../../lib/prisma";
import { logger } from "../../config/logger";
import { buildIncidentDiagnosis } from "./remediation-suggest.service";
import { executeRemediation } from "./remediation.service";
import {
  AUTO_RUN_ALLOWLIST,
  buildPolicySnapshot,
  checkAutoRunPolicy,
  checkCooldown,
  checkSuppressionGuard,
  getAutoRunPolicy,
  isActionAllowedByPolicy,
  upsertPolicy
} from "./auto-run-policy.service";
import type { RemediationAction } from "./actions";
import type { RemediationContext } from "./types";
import {
  acquireRemediationLock,
  buildAutoHealLockKey,
  releaseRemediationLock
} from "./remediation-lock.service";
import { findActiveMaintenanceForService } from "../maintenance-window-policy.service";
import { assertPolicyControlledRemediationAllowed } from "../entitlements/remediation-governance.service";
import { isEntitlementError } from "../entitlements/entitlement.service";
import { projectAllowsAutonomousExecution } from "../automation/project-autonomous-mode.service";

export interface AutoHealAttemptResult {
  incidentId: string;
  attempted: boolean;
  action?: RemediationAction;
  logId?: string;
  status?: string;
  summary?: string;
  blockedReason?: string;
}

const isEnabled = (): boolean => process.env.AUTO_REMEDIATION_ENABLED !== "false";

const ensureDefaultPolicy = async (organizationId: string): Promise<void> => {
  if (process.env.AUTO_HEAL_DEFAULT_ENABLED !== "true") return;
  const existing = await prisma.autoRemediationPolicy.findFirst({
    where: { organizationId, policyType: "GLOBAL", policyKey: "" }
  });
  if (!existing) {
    await upsertPolicy(organizationId, "GLOBAL", "", true, "auto-heal-bootstrap");
  }
};

const buildContext = async (
  organizationId: string,
  incidentId: string
): Promise<RemediationContext | null> => {
  const incident = await prisma.incident.findFirst({
    where: { id: incidentId, Project: { organizationId } },
    include: {
      IncidentAlert: {
        include: { Alert: { select: { id: true, serviceId: true } } },
        take: 1
      }
    }
  });
  if (!incident) return null;

  const leadAlert = incident.IncidentAlert[0]?.Alert;
  return {
    organizationId,
    projectId: incident.projectId,
    incidentId: incident.id,
    alertId: leadAlert?.id,
    serviceId: leadAlert?.serviceId ?? undefined,
    extra: { severity: incident.severity }
  };
};

const pickAutoAction = async (
  organizationId: string,
  incidentId: string,
  projectId: string,
  actions: Array<{ action: RemediationAction; autoRunEligible: boolean }>
): Promise<{ action: RemediationAction; blockedReason?: string } | null> => {
  for (const candidate of actions) {
    if (!candidate.autoRunEligible || !AUTO_RUN_ALLOWLIST.has(candidate.action)) {
      continue;
    }

    const policy = await checkAutoRunPolicy(organizationId, candidate.action, projectId);
    if (!isActionAllowedByPolicy({ action: candidate.action, policyCheck: policy })) {
      continue;
    }

    const cooldown = await checkCooldown(organizationId, candidate.action, incidentId);
    if (!cooldown.cooledDown) {
      continue;
    }

    const suppression = await checkSuppressionGuard(organizationId, candidate.action);
    if (suppression.suppressed) {
      continue;
    }

    return { action: candidate.action };
  }

  return null;
};

export const runIncidentAutoHeal = async (
  organizationId: string,
  incidentId: string
): Promise<AutoHealAttemptResult> => {
  if (!isEnabled()) {
    return { incidentId, attempted: false, blockedReason: "AUTO_REMEDIATION_ENABLED=false" };
  }

  const lockKey = buildAutoHealLockKey(organizationId, incidentId);
  const lock = await acquireRemediationLock({
    lockKey,
    organizationId,
    incidentId,
    action: "AUTO_HEAL",
    holder: `auto-heal:${incidentId}`
  });
  if (lock.acquired === false) {
    return {
      incidentId,
      attempted: false,
      blockedReason: lock.reason
    };
  }

  try {
    return await runIncidentAutoHealLocked(organizationId, incidentId);
  } finally {
    await releaseRemediationLock(lockKey, `auto-heal:${incidentId}`);
  }
};

const runIncidentAutoHealLocked = async (
  organizationId: string,
  incidentId: string
): Promise<AutoHealAttemptResult> => {
  try {
    await assertPolicyControlledRemediationAllowed(organizationId);
  } catch (error) {
    if (isEntitlementError(error)) {
      return {
        incidentId,
        attempted: false,
        blockedReason: error.message
      };
    }
    throw error;
  }

  await ensureDefaultPolicy(organizationId);

  const incident = await prisma.incident.findFirst({
    where: { id: incidentId, Project: { organizationId } },
    select: { id: true, status: true, projectId: true, title: true, severity: true }
  });
  if (!incident) {
    return { incidentId, attempted: false, blockedReason: "Incident not found" };
  }
  if (incident.status === "RESOLVED") {
    return { incidentId, attempted: false, blockedReason: "Incident already resolved" };
  }

  const projectGate = await projectAllowsAutonomousExecution({
    organizationId,
    projectId: incident.projectId
  });
  if (!projectGate.allowed) {
    return { incidentId, attempted: false, blockedReason: projectGate.reason };
  }

  const contextForMaintenance = await buildContext(organizationId, incidentId);
  if (contextForMaintenance) {
    const maintenance = await findActiveMaintenanceForService({
      organizationId,
      projectId: incident.projectId,
      serviceId: contextForMaintenance.serviceId
    });
    if (maintenance.inMaintenance && !maintenance.allowAutonomous) {
      return {
        incidentId,
        attempted: false,
        blockedReason: `Maintenance window active: ${maintenance.windowName ?? maintenance.windowId}`
      };
    }
  }

  const recentAuto = await prisma.remediationLog.findFirst({
    where: {
      organizationId,
      incidentId,
      executionMode: "AUTOMATIC",
      createdAt: { gte: new Date(Date.now() - 10 * 60_000) }
    },
    select: { id: true }
  });
  if (recentAuto) {
    return { incidentId, attempted: false, blockedReason: "Recent automatic remediation already attempted" };
  }

  const diagnosis = await buildIncidentDiagnosis(organizationId, { incidentId });
  const context = await buildContext(organizationId, incidentId);
  if (!context) {
    return { incidentId, attempted: false, blockedReason: "Unable to build remediation context" };
  }

  const policy = await getAutoRunPolicy(organizationId);
  if (!policy.enabled) {
    return { incidentId, attempted: false, blockedReason: "Global auto-remediation policy disabled" };
  }

  if (diagnosis.failureClass === "HTTP_STATUS_MISMATCH") {
    const policyCheck = await checkAutoRunPolicy(organizationId, "RERUN_HTTP_CHECK", incident.projectId);
    const confirmation = await executeRemediation("RERUN_HTTP_CHECK", context, {
      auto: true,
      executionMode: "AUTOMATIC",
      executedBy: "auto-heal",
      skipLock: true,
      idempotencyKey: `auto-heal:${incidentId}:rerun-http-check`,
      policySnapshot: buildPolicySnapshot({
        enabled: policy.enabled,
        allowedActionKeys: policy.allowedActionKeys,
        cooldownMinutes: policy.cooldownMinutes,
        level: policyCheck.level,
        reason: policyCheck.reason
      }) as unknown as Record<string, unknown>
    });

    const recommendation =
      "Auto-heal confirmation check completed. Review whether the expected HTTP status is still correct for this environment. " +
      "Changing check configuration requires manual approval and is not performed automatically.";

    if (incident.status === "OPEN") {
      await executeRemediation("ACKNOWLEDGE_INCIDENT", context, {
        auto: true,
        executionMode: "AUTOMATIC",
        executedBy: "auto-heal",
        skipLock: true,
        idempotencyKey: `auto-heal:${incidentId}:acknowledge`
      });
    }

    await executeRemediation(
      "ADD_INCIDENT_NOTE",
      { ...context, note: `${recommendation} Confirmation result: ${confirmation.result.summary}` },
      {
        auto: true,
        executionMode: "AUTOMATIC",
        executedBy: "auto-heal",
        skipLock: true,
        idempotencyKey: `auto-heal:${incidentId}:note-mismatch`
      }
    );

    return {
      incidentId,
      attempted: true,
      action: "RERUN_HTTP_CHECK",
      logId: confirmation.logId,
      status: confirmation.result.status,
      summary: recommendation
    };
  }

  const picked = await pickAutoAction(
    organizationId,
    incidentId,
    incident.projectId,
    diagnosis.suggestedActions.map((row) => ({
      action: row.action,
      autoRunEligible: row.autoRunEligible
    }))
  );

  if (!picked) {
    return {
      incidentId,
      attempted: false,
      blockedReason: "No eligible auto-heal action passed policy, cooldown, and suppression checks"
    };
  }

  if (process.env.AUTO_HEAL_ACK_FIRST === "true" && incident.status === "OPEN") {
    await executeRemediation(
      "ACKNOWLEDGE_INCIDENT",
      context,
      {
        auto: true,
        executionMode: "AUTOMATIC",
        executedBy: "auto-heal",
        skipLock: true,
        idempotencyKey: `auto-heal:${incidentId}:ack-first`
      }
    );
  }

  const policyCheck = await checkAutoRunPolicy(organizationId, picked.action, incident.projectId);
  const executed = await executeRemediation(picked.action, context, {
    auto: true,
    executionMode: "AUTOMATIC",
    executedBy: "auto-heal",
    skipLock: true,
    idempotencyKey: `auto-heal:${incidentId}:${picked.action}`,
    policySnapshot: buildPolicySnapshot({
      enabled: policy.enabled,
      allowedActionKeys: policy.allowedActionKeys,
      cooldownMinutes: policy.cooldownMinutes,
      level: policyCheck.level,
      reason: policyCheck.reason
    }) as unknown as Record<string, unknown>
  });

  await executeRemediation(
    "ADD_INCIDENT_NOTE",
    {
      ...context,
      note: `Auto-heal attempted ${picked.action}: ${executed.result.summary} (analysis: ${diagnosis.analysisMode}, confidence ${Math.round(diagnosis.confidence * 100)}%).`
    },
    {
      auto: true,
      executionMode: "AUTOMATIC",
      executedBy: "auto-heal",
      skipLock: true,
      idempotencyKey: `auto-heal:${incidentId}:note`
    }
  );

  logger.info(
    { incidentId, action: picked.action, status: executed.result.status },
    "Incident auto-heal attempt completed"
  );

  return {
    incidentId,
    attempted: true,
    action: picked.action,
    logId: executed.logId,
    status: executed.result.status,
    summary: executed.result.summary
  };
};

export const runAutoHealSweep = async (organizationId?: string): Promise<AutoHealAttemptResult[]> => {
  const openIncidents = await prisma.incident.findMany({
    where: {
      status: { in: ["OPEN", "INVESTIGATING", "MONITORING"] },
      ...(organizationId ? { Project: { organizationId } } : {})
    },
    select: { id: true, Project: { select: { organizationId: true } } },
    orderBy: { openedAt: "desc" },
    take: Number(process.env.AUTO_HEAL_SWEEP_LIMIT || 10)
  });

  const results: AutoHealAttemptResult[] = [];
  for (const incident of openIncidents) {
    const orgId = incident.Project.organizationId;
    if (!orgId) continue;
    results.push(await runIncidentAutoHeal(orgId, incident.id));
  }
  return results;
};

export const bootstrapAutoHealPolicies = async (): Promise<void> => {
  if (process.env.AUTO_HEAL_DEFAULT_ENABLED !== "true") return;
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  for (const org of orgs) {
    await ensureDefaultPolicy(org.id);
  }
};
