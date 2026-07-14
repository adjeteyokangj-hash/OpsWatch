import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { REMEDIATION_REGISTRY, requiresApproval, type RemediationAction } from "../remediation/actions";
import {
  buildPolicySnapshot,
  checkAutoRunPolicy,
  checkCooldown,
  checkSuppressionGuard,
  getAutoRunPolicy
} from "../remediation/auto-run-policy.service";
import {
  acquireRemediationLock,
  releaseRemediationLock
} from "../remediation/remediation-lock.service";
import { executeRemediation } from "../remediation/remediation.service";
import type { RemediationContext } from "../remediation/types";
import { isSkippableOnFailure, mapPlaybookActionToRemediation } from "./automation-action-map";
import type { AutomationPlan } from "./automation-planner.service";
import {
  checkAutomationRateLimits,
  checkCircuitBreaker
} from "./automation-safeguards.service";
import { findActiveMaintenanceForService } from "../maintenance-window-policy.service";
import { assertAutonomousRemediationAllowed } from "../entitlements/remediation-governance.service";
import { isEntitlementError } from "../entitlements/entitlement.service";
import {
  completeProjectRecovery,
  enterProjectRecovering,
  failProjectRecovery
} from "../project-recovery-lifecycle.service";

export type AutomationRunStatus =
  | "PLANNED"
  | "APPROVAL_PENDING"
  | "APPROVED"
  | "EXECUTING"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "ROLLBACK_PENDING"
  | "ROLLED_BACK"
  | "REJECTED"
  | "CANCELLED"
  | "SUPERSEDED";

const TERMINAL_RUN_STATUSES = new Set<AutomationRunStatus>([
  "COMPLETED",
  "FAILED",
  "ROLLED_BACK",
  "REJECTED",
  "CANCELLED",
  "SUPERSEDED"
]);

const APPROVABLE_STATUSES = new Set<AutomationRunStatus>(["PLANNED", "APPROVAL_PENDING"]);

export type AutomationRunExecutionResult = {
  runId: string;
  status: AutomationRunStatus;
  summary: string;
  currentStepOrder?: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

export const buildAutomationRunLockKey = (organizationId: string, incidentId: string): string =>
  `automation-run:${organizationId}:${incidentId}`;

export const buildAutomationStepIdempotencyKey = (
  runId: string,
  stepId: string,
  attemptNumber: number
): string => `automation:${runId}:step:${stepId}:attempt:${attemptNumber}`;

const safeWriteTimeline = async (input: {
  incidentId: string;
  projectId: string;
  summary: string;
  sourceId?: string;
  payload?: Record<string, unknown>;
}): Promise<void> => {
  try {
    await prisma.incidentTimelineEvent.create({
      data: {
        id: randomUUID(),
        incidentId: input.incidentId,
        projectId: input.projectId,
        eventType: "AUTOMATION",
        summary: input.summary,
        sourceType: "AUTOMATION_RUN",
        sourceId: input.sourceId,
        payloadJson: (input.payload ?? {}) as object
      }
    });
  } catch {
    // Timeline write failure must not mask automation outcome.
  }
};

const safeWriteAudit = async (input: {
  userId?: string | null;
  action: string;
  entityId: string;
  metadata: Record<string, unknown>;
}): Promise<void> => {
  try {
    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        userId: input.userId ?? null,
        action: input.action,
        entityType: "AUTOMATION_RUN",
        entityId: input.entityId,
        metadataJson: input.metadata as object
      }
    });
  } catch {
    // Audit failure must not mask automation outcome.
  }
};

export const supersedeActiveAutomationRuns = async (input: {
  organizationId: string;
  incidentId: string;
  supersededByRunId: string;
}): Promise<void> => {
  const activeRuns = await prisma.automationRun.findMany({
    where: {
      organizationId: input.organizationId,
      incidentId: input.incidentId,
      status: { notIn: [...TERMINAL_RUN_STATUSES] }
    },
    select: { id: true }
  });
  if (activeRuns.length === 0) return;

  await prisma.automationRun.updateMany({
    where: { id: { in: activeRuns.map((row) => row.id) } },
    data: {
      status: "SUPERSEDED",
      supersededByRunId: input.supersededByRunId,
      updatedAt: new Date()
    }
  });
};

const loadRunOrThrow = async (organizationId: string, runId: string) => {
  const run = await prisma.automationRun.findFirst({
    where: { id: runId, organizationId },
    include: {
      Steps: { orderBy: { stepOrder: "asc" } },
      Version: { include: { Playbook: true, Steps: { orderBy: { stepOrder: "asc" } } } }
    }
  });
  if (!run) throw new Error("Automation run not found");
  return run;
};

const assertIncidentOpen = async (incidentId: string): Promise<void> => {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: { id: true, status: true }
  });
  if (!incident) throw new Error("Incident not found or deleted");
  if (incident.status === "RESOLVED") {
    throw new Error("Cannot approve or execute automation for a resolved incident");
  }
};

const parsePlan = (planJson: unknown): AutomationPlan => planJson as AutomationPlan;

const verifyPlaybookVersionUnchanged = async (run: {
  versionId: string;
  approvedVersionId: string | null;
  planJson: unknown;
  Version: { Steps: Array<{ stepOrder: number; action: string; approvalRequired: boolean; description: string }> };
}): Promise<void> => {
  const approvedVersionId = run.approvedVersionId ?? run.versionId;
  if (approvedVersionId !== run.versionId) {
    throw new Error("Playbook version changed after approval; execution refused");
  }

  const plan = parsePlan(run.planJson);
  const versionSteps = run.Version.Steps.map((step) => ({
    order: step.stepOrder,
    action: step.action,
    approvalRequired: step.approvalRequired,
    description: step.description
  }));
  const planSteps = plan.steps.map((step) => ({
    order: step.order,
    action: step.action,
    approvalRequired: step.approvalRequired,
    description: step.description
  }));
  if (JSON.stringify(versionSteps) !== JSON.stringify(planSteps)) {
    throw new Error("Playbook definition changed after approval; execution refused");
  }
};

const evaluateAutomationPolicy = async (
  organizationId: string
): Promise<{ enabled: boolean; executionMode: string }> => {
  const policy = await prisma.automationPolicy.findUnique({
    where: { organizationId_policyKey: { organizationId, policyKey: "GLOBAL" } }
  });
  return {
    enabled: policy?.enabled ?? false,
    executionMode: policy?.executionMode ?? "OBSERVE"
  };
};

const buildRemediationContext = async (input: {
  organizationId: string;
  projectId: string;
  incidentId: string;
  step: { action: string; targetServiceId?: string | null };
  plan: AutomationPlan;
  approvalReason?: string;
  stepExtra?: Record<string, unknown>;
}): Promise<RemediationContext> => {
  const incident = await prisma.incident.findUnique({
    where: { id: input.incidentId },
    include: {
      IncidentAlert: {
        include: { Alert: { select: { id: true, serviceId: true } } },
        take: 1
      }
    }
  });
  const leadAlert = incident?.IncidentAlert[0]?.Alert;
  const serviceId = input.step.targetServiceId ?? leadAlert?.serviceId ?? undefined;

  let checkId: string | undefined;
  if (serviceId) {
    const check = await prisma.check.findFirst({
      where: { serviceId, isActive: true, type: "HTTP" },
      orderBy: { updatedAt: "desc" },
      select: { id: true }
    });
    checkId = check?.id;
  }

  if (input.step.action === "ADD_INCIDENT_NOTE") {
    const recentResults = checkId
      ? await prisma.checkResult.findMany({
          where: { checkId },
          orderBy: { checkedAt: "desc" },
          take: 5,
          select: { status: true, responseCode: true, message: true, checkedAt: true }
        })
      : [];
    return {
      organizationId: input.organizationId,
      projectId: input.projectId,
      incidentId: input.incidentId,
      alertId: leadAlert?.id,
      serviceId,
      checkId,
      note:
        recentResults.length > 0
          ? `Automation investigation summary: ${recentResults
              .map(
                (row) =>
                  `${row.checkedAt.toISOString()} ${row.status} ${row.responseCode ?? "n/a"} ${row.message}`
              )
              .join(" | ")}`
          : "Automation investigation summary: no recent check history available.",
      extra: { severity: incident?.severity, automationPlaybookKey: input.plan.playbookKey }
    };
  }

  const extra: Record<string, unknown> = {
    severity: incident?.severity,
    automationPlaybookKey: input.plan.playbookKey,
    ...(input.stepExtra ?? {})
  };

  if (input.step.action === "REVIEW_HTTP_EXPECTED_STATUS") {
    const latestFailure = checkId
      ? await prisma.checkResult.findFirst({
          where: { checkId, status: "FAIL" },
          orderBy: { checkedAt: "desc" },
          select: { responseCode: true, rawJson: true }
        })
      : null;
    const rawActual =
      latestFailure?.rawJson && typeof latestFailure.rawJson === "object" && latestFailure.rawJson !== null
        ? (latestFailure.rawJson as { actualStatusCode?: number }).actualStatusCode
        : undefined;
    extra.newExpectedStatusCode =
      typeof input.stepExtra?.newExpectedStatusCode === "number"
        ? input.stepExtra.newExpectedStatusCode
        : latestFailure?.responseCode ?? rawActual;
    extra.approvalReason = input.approvalReason ?? "Approved via automation run";
    extra.actualStatusCode = latestFailure?.responseCode ?? rawActual;
  }

  return {
    organizationId: input.organizationId,
    projectId: input.projectId,
    incidentId: input.incidentId,
    alertId: leadAlert?.id,
    serviceId,
    checkId,
    extra
  };
};

const reevaluateStepPolicy = async (input: {
  organizationId: string;
  projectId: string;
  incidentId: string;
  action: RemediationAction;
}): Promise<{ allowed: boolean; reason: string; policySnapshot: Record<string, unknown> }> => {
  const automationPolicy = await evaluateAutomationPolicy(input.organizationId);
  if (!automationPolicy.enabled) {
    return { allowed: false, reason: "Automation policy is disabled", policySnapshot: automationPolicy };
  }
  if (automationPolicy.executionMode === "OBSERVE") {
    return { allowed: false, reason: "Automation policy is in observe mode", policySnapshot: automationPolicy };
  }

  const policy = await getAutoRunPolicy(input.organizationId);
  const policyCheck = await checkAutoRunPolicy(input.organizationId, input.action, input.projectId);
  const cooldown = await checkCooldown(input.organizationId, input.action, input.incidentId);
  const suppression = await checkSuppressionGuard(input.organizationId, input.action);

  const reasons: string[] = [];
  if (!cooldown.cooledDown) reasons.push(cooldown.reason ?? "Cooldown active");
  if (suppression.suppressed) reasons.push(suppression.reason ?? "Suppression active");
  if (!policyCheck.allowed && automationPolicy.executionMode !== "APPROVAL") {
    reasons.push(policyCheck.reason);
  }

  const policySnapshot = buildPolicySnapshot({
    enabled: policy.enabled,
    allowedActionKeys: policy.allowedActionKeys,
    cooldownMinutes: policy.cooldownMinutes,
    level: policyCheck.level,
    reason: policyCheck.reason
  }) as unknown as Record<string, unknown>;

  return {
    allowed: reasons.length === 0 || automationPolicy.executionMode === "APPROVAL",
    reason: reasons.join("; ") || "Allowed",
    policySnapshot: { ...policySnapshot, automationPolicy }
  };
};

const finalizeFailedRun = async (
  run: { id: string; incidentId: string; projectId: string },
  stepOrder: number,
  summary: string
): Promise<void> => {
  await prisma.automationRun.update({
    where: { id: run.id },
    data: { status: "FAILED", currentStepOrder: stepOrder, updatedAt: new Date() }
  });
  await safeWriteTimeline({
    incidentId: run.incidentId,
    projectId: run.projectId,
    sourceId: run.id,
    summary: `Automation run failed: ${summary}`,
    payload: { runId: run.id, stepOrder, status: "FAILED" }
  });
};

const executeApprovedRun = async (input: {
  organizationId: string;
  runId: string;
  executedBy: string;
  approvalReason: string;
}): Promise<AutomationRunExecutionResult> => {
  const run = await loadRunOrThrow(input.organizationId, input.runId);
  await assertIncidentOpen(run.incidentId);
  await verifyPlaybookVersionUnchanged(run);

  const plan = parsePlan(run.planJson);
  const lockKey = buildAutomationRunLockKey(input.organizationId, run.incidentId);
  const lockHolder = `automation-run:${run.id}`;
  const lock = await acquireRemediationLock({
    lockKey,
    organizationId: input.organizationId,
    incidentId: run.incidentId,
    action: "AUTOMATION_RUN",
    holder: lockHolder
  });
  if (lock.acquired === false) throw new Error(lock.reason);

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const projectBefore = await prisma.project.findUnique({
    where: { id: run.projectId },
    select: { status: true }
  });
  let recoveryEntered = false;

  try {
    await prisma.automationRun.update({
      where: { id: run.id },
      data: { status: "EXECUTING", updatedAt: new Date() }
    });

    for (const step of run.Steps) {
      if (step.status === "SUCCEEDED") {
        succeeded += 1;
        continue;
      }
      if (step.status === "SKIPPED") {
        skipped += 1;
        continue;
      }

      const planStep = plan.steps.find((row) => row.order === step.stepOrder);
      if (!planStep) throw new Error(`Plan step ${step.stepOrder} missing from immutable plan snapshot`);

      const remediationAction = mapPlaybookActionToRemediation(step.action);
      if (!remediationAction) {
        failed += 1;
        await prisma.automationRunStep.update({
          where: { id: step.id },
          data: { status: "FAILED", resultJson: { summary: `Unsupported playbook action ${step.action}` } }
        });
        await finalizeFailedRun(run, step.stepOrder, `Unsupported playbook action ${step.action}`);
        return {
          runId: run.id,
          status: "FAILED",
          summary: `Unsupported playbook action ${step.action}`,
          currentStepOrder: step.stepOrder,
          succeeded,
          failed,
          skipped
        };
      }

      const policyEval = await reevaluateStepPolicy({
        organizationId: input.organizationId,
        projectId: run.projectId,
        incidentId: run.incidentId,
        action: remediationAction
      });
      if (!policyEval.allowed) {
        failed += 1;
        await finalizeFailedRun(run, step.stepOrder, policyEval.reason);
        return {
          runId: run.id,
          status: "FAILED",
          summary: policyEval.reason,
          currentStepOrder: step.stepOrder,
          succeeded,
          failed,
          skipped
        };
      }

      const circuit = await checkCircuitBreaker({
        organizationId: input.organizationId,
        action: remediationAction,
        incidentId: run.incidentId
      });
      if (!circuit.allowed) {
        failed += 1;
        await finalizeFailedRun(run, step.stepOrder, circuit.reason);
        return {
          runId: run.id,
          status: "FAILED",
          summary: circuit.reason,
          currentStepOrder: step.stepOrder,
          succeeded,
          failed,
          skipped
        };
      }

      const rateLimit = await checkAutomationRateLimits({
        organizationId: input.organizationId,
        incidentId: run.incidentId,
        serviceId: step.targetServiceId ?? undefined,
        playbookKey: plan.playbookKey,
        phase: "EXECUTE"
      });
      if (!rateLimit.allowed) {
        failed += 1;
        await finalizeFailedRun(run, step.stepOrder, rateLimit.reason);
        return {
          runId: run.id,
          status: "FAILED",
          summary: rateLimit.reason,
          currentStepOrder: step.stepOrder,
          succeeded,
          failed,
          skipped
        };
      }

      await prisma.automationRun.update({
        where: { id: run.id },
        data: { currentStepOrder: step.stepOrder, updatedAt: new Date() }
      });

      const isVerificationStep = step.action === "VERIFY_SERVICE";
      if (isVerificationStep && !recoveryEntered) {
        await enterProjectRecovering({
          projectId: run.projectId,
          incidentId: run.incidentId,
          runId: run.id,
          previousStatus: projectBefore?.status
        });
        recoveryEntered = true;
        await prisma.automationRun.update({
          where: { id: run.id },
          data: { status: "VERIFYING", updatedAt: new Date() }
        });
      }

      await prisma.automationRunStep.update({
        where: { id: step.id },
        data: { status: isVerificationStep ? "VERIFYING" : "EXECUTING" }
      });

      const context = await buildRemediationContext({
        organizationId: input.organizationId,
        projectId: run.projectId,
        incidentId: run.incidentId,
        step,
        plan,
        approvalReason: input.approvalReason
      });

      const stepApproved = step.approvalRequired || requiresApproval(remediationAction);

      const executed = await executeRemediation(remediationAction, context, {
        approved: stepApproved,
        executionMode: "APPROVED",
        executedBy: input.executedBy,
        auto: false,
        skipLock: true,
        idempotencyKey: buildAutomationStepIdempotencyKey(run.id, step.id, 1),
        policySnapshot: policyEval.policySnapshot
      });

      const investigationConfirmation =
        (step.action === "RERUN_CHECK" || step.action === "VERIFY_SERVICE") &&
        remediationAction === "RERUN_HTTP_CHECK";
      const stepSuccess = investigationConfirmation
        ? !["MISSING_CONTEXT", "MISCONFIGURED_ENV", "UNSUPPORTED"].includes(executed.result.status)
        : executed.result.success;
      const rolledBack =
        remediationAction === "REVIEW_HTTP_EXPECTED_STATUS" &&
        !stepSuccess &&
        (executed.result.summary.toLowerCase().includes("rolled back") ||
          Boolean((executed.result.details as { rolledBack?: boolean } | undefined)?.rolledBack));

      await prisma.automationRunStep.update({
        where: { id: step.id },
        data: {
          status: stepSuccess ? "SUCCEEDED" : rolledBack ? "ROLLED_BACK" : "FAILED",
          remediationLogId: executed.logId,
          resultJson: executed.result as object
        }
      });

      if (stepSuccess) {
        succeeded += 1;
        continue;
      }

      if (isSkippableOnFailure(step.action)) {
        skipped += 1;
        await prisma.automationRunStep.update({ where: { id: step.id }, data: { status: "SKIPPED" } });
        continue;
      }

      failed += 1;
      const finalStatus: AutomationRunStatus = rolledBack ? "ROLLED_BACK" : "FAILED";
      if (rolledBack) {
        await prisma.automationRun.update({
          where: { id: run.id },
          data: { status: "ROLLBACK_PENDING", updatedAt: new Date() }
        });
        await prisma.automationRun.update({
          where: { id: run.id },
          data: { status: "ROLLED_BACK", updatedAt: new Date() }
        });
      } else {
        await finalizeFailedRun(run, step.stepOrder, executed.result.summary);
        if (step.action === "VERIFY_SERVICE") {
          await failProjectRecovery({
            projectId: run.projectId,
            incidentId: run.incidentId,
            runId: run.id,
            fallbackStatus: projectBefore?.status === "DOWN" ? "DOWN" : "DEGRADED"
          });
        }
      }

      await prisma.automationOutcome.create({
        data: {
          id: randomUUID(),
          runId: run.id,
          summary: executed.result.summary,
          success: false,
          detailsJson: { stepOrder: step.stepOrder, action: step.action, remediationLogId: executed.logId, rolledBack }
        }
      });

      return {
        runId: run.id,
        status: finalStatus,
        summary: executed.result.summary,
        currentStepOrder: step.stepOrder,
        succeeded,
        failed,
        skipped
      };
    }

    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - run.createdAt.getTime());
    await prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        currentStepOrder: null,
        durationMs,
        verificationStatus: recoveryEntered ? "VERIFIED" : "COMPLETED",
        verifiedAt: recoveryEntered ? completedAt : null,
        updatedAt: completedAt
      }
    });
    if (recoveryEntered) {
      await completeProjectRecovery({
        projectId: run.projectId,
        incidentId: run.incidentId,
        runId: run.id
      });
    }
    await prisma.automationOutcome.create({
      data: {
        id: randomUUID(),
        runId: run.id,
        summary: `Automation run completed (${succeeded} succeeded, ${skipped} skipped).`,
        success: true,
        detailsJson: { succeeded, failed, skipped, durationMs }
      }
    });
    await safeWriteTimeline({
      incidentId: run.incidentId,
      projectId: run.projectId,
      sourceId: run.id,
      summary: `Automation run completed (${succeeded} succeeded, ${skipped} skipped, ${failed} failed).`,
      payload: { runId: run.id, status: "COMPLETED", succeeded, skipped, failed, durationMs }
    });

    try {
      const { recordObservation, recordOperationsTimelineEvent, recordAiDecisionAudit } =
        await import("../intelligence/observation.service");
      const { OBSERVATION_SOURCE, TIMELINE_EVENT, AI_DECISION_TYPE } =
        await import("../intelligence/intelligence-constants");
      await recordObservation({
        organizationId: run.organizationId,
        projectId: run.projectId,
        sourceType: OBSERVATION_SOURCE.AUTOMATION,
        sourceId: run.id,
        eventKey: "automation.executed",
        summary: `Automation run completed (${succeeded} succeeded)`,
        payloadJson: { succeeded, failed, skipped, durationMs, incidentId: run.incidentId }
      });
      await recordOperationsTimelineEvent({
        organizationId: run.organizationId,
        projectId: run.projectId,
        eventType: recoveryEntered
          ? TIMELINE_EVENT.RECOVERY_VERIFIED
          : TIMELINE_EVENT.AUTOMATION_EXECUTED,
        summary: recoveryEntered
          ? "Automation recovery verified"
          : "Automation executed",
        sourceType: "AUTOMATION",
        sourceId: run.id
      });
      await recordAiDecisionAudit({
        organizationId: run.organizationId,
        decisionType: AI_DECISION_TYPE.AUTOMATE,
        subjectType: "AUTOMATION_RUN",
        subjectId: run.id,
        summary: `Automation run completed with ${succeeded} succeeded step(s)`,
        confidenceScore: run.confidence ?? null,
        outcome: "EXECUTED",
        evidenceJson: { succeeded, failed, skipped, durationMs }
      });
    } catch {
      // Intelligence recording must not fail the run.
    }

    return {
      runId: run.id,
      status: "COMPLETED",
      summary: `Automation run completed (${succeeded} succeeded, ${skipped} skipped).`,
      succeeded,
      failed,
      skipped
    };
  } finally {
    await releaseRemediationLock(lockKey, lockHolder);
  }
};

export const approveAutomationRun = async (input: {
  organizationId: string;
  runId: string;
  approvedBy: string;
  reason: string;
}): Promise<AutomationRunExecutionResult> => {
  const run = await loadRunOrThrow(input.organizationId, input.runId);
  await assertIncidentOpen(run.incidentId);
  if (!input.reason.trim()) throw new Error("Approval reason is required");
  if (!APPROVABLE_STATUSES.has(run.status as AutomationRunStatus)) {
    throw new Error(`Run cannot be approved from status ${run.status}`);
  }
  if (run.approvedBy) throw new Error("Automation run has already been approved");
  if (run.executionMode !== "APPROVAL" && run.executionMode !== "AUTONOMOUS") {
    throw new Error(`Run execution mode ${run.executionMode} does not support approval execution`);
  }

  const automationPolicy = await evaluateAutomationPolicy(input.organizationId);
  if (!automationPolicy.enabled) throw new Error("Automation policy is disabled");
  if (automationPolicy.executionMode === "OBSERVE") {
    throw new Error("Automation policy is in observe mode");
  }

  const now = new Date();
  await prisma.automationApproval.create({
    data: {
      id: randomUUID(),
      runId: run.id,
      approvedBy: input.approvedBy,
      reason: input.reason.trim(),
      decision: "APPROVED",
      scope: "RUN"
    }
  });
  await prisma.automationRun.update({
    where: { id: run.id },
    data: {
      approvedBy: input.approvedBy,
      approvedAt: now,
      approvedVersionId: run.versionId,
      status: "APPROVED",
      updatedAt: now
    }
  });
  await safeWriteAudit({
    userId: input.approvedBy,
    action: "AUTOMATION_RUN_APPROVED",
    entityId: run.id,
    metadata: {
      incidentId: run.incidentId,
      reason: input.reason.trim(),
      playbookVersion: parsePlan(run.planJson).playbookVersion,
      scope: "RUN"
    }
  });
  await safeWriteTimeline({
    incidentId: run.incidentId,
    projectId: run.projectId,
    sourceId: run.id,
    summary: `Automation run approved for execution (${parsePlan(run.planJson).playbookKey}).`,
    payload: { runId: run.id, approvedBy: input.approvedBy, reason: input.reason.trim(), scope: "RUN" }
  });

  return executeApprovedRun({
    organizationId: input.organizationId,
    runId: run.id,
    executedBy: input.approvedBy,
    approvalReason: input.reason.trim()
  });
};

export const rejectAutomationRun = async (input: {
  organizationId: string;
  runId: string;
  rejectedBy: string;
  reason: string;
}): Promise<void> => {
  const run = await loadRunOrThrow(input.organizationId, input.runId);
  await assertIncidentOpen(run.incidentId);
  if (!input.reason.trim()) throw new Error("Rejection reason is required");
  if (!APPROVABLE_STATUSES.has(run.status as AutomationRunStatus)) {
    throw new Error(`Run cannot be rejected from status ${run.status}`);
  }

  await prisma.automationApproval.create({
    data: {
      id: randomUUID(),
      runId: run.id,
      approvedBy: input.rejectedBy,
      reason: input.reason.trim(),
      decision: "REJECTED",
      scope: "RUN"
    }
  });
  await prisma.automationRun.update({
    where: { id: run.id },
    data: { status: "REJECTED", updatedAt: new Date() }
  });
  await safeWriteAudit({
    userId: input.rejectedBy,
    action: "AUTOMATION_RUN_REJECTED",
    entityId: run.id,
    metadata: { incidentId: run.incidentId, reason: input.reason.trim() }
  });
  await safeWriteTimeline({
    incidentId: run.incidentId,
    projectId: run.projectId,
    sourceId: run.id,
    summary: "Automation run rejected by operator.",
    payload: { runId: run.id, rejectedBy: input.rejectedBy, reason: input.reason.trim(), status: "REJECTED" }
  });
};

export const cancelAutomationRun = async (input: {
  organizationId: string;
  runId: string;
  cancelledBy: string;
  reason?: string;
}): Promise<void> => {
  const run = await loadRunOrThrow(input.organizationId, input.runId);
  if (["EXECUTING", "VERIFYING", "COMPLETED", "REJECTED", "CANCELLED", "SUPERSEDED"].includes(run.status)) {
    throw new Error(`Run cannot be cancelled from status ${run.status}`);
  }

  await prisma.automationRun.update({
    where: { id: run.id },
    data: {
      status: "CANCELLED",
      cancelledBy: input.cancelledBy,
      cancelledAt: new Date(),
      updatedAt: new Date()
    }
  });
  await safeWriteAudit({
    userId: input.cancelledBy,
    action: "AUTOMATION_RUN_CANCELLED",
    entityId: run.id,
    metadata: { incidentId: run.incidentId, reason: input.reason?.trim() || "Cancelled by operator" }
  });
  await safeWriteTimeline({
    incidentId: run.incidentId,
    projectId: run.projectId,
    sourceId: run.id,
    summary: "Automation run cancelled.",
    payload: {
      runId: run.id,
      cancelledBy: input.cancelledBy,
      reason: input.reason?.trim() || "Cancelled by operator",
      status: "CANCELLED"
    }
  });
};

export const requestAutomationApproval = async (input: {
  organizationId: string;
  runId: string;
  requestedBy: string;
}): Promise<void> => {
  const run = await loadRunOrThrow(input.organizationId, input.runId);
  await assertIncidentOpen(run.incidentId);
  if (run.status !== "PLANNED") throw new Error(`Run cannot request approval from status ${run.status}`);
  if (run.executionMode !== "APPROVAL") {
    throw new Error("Only approval-mode runs can request operator approval");
  }

  await prisma.automationRun.update({
    where: { id: run.id },
    data: { status: "APPROVAL_PENDING", updatedAt: new Date() }
  });
  await safeWriteTimeline({
    incidentId: run.incidentId,
    projectId: run.projectId,
    sourceId: run.id,
    summary: "Automation run submitted for operator approval.",
    payload: { runId: run.id, requestedBy: input.requestedBy, status: "APPROVAL_PENDING" }
  });
};

export const executeAutonomousRun = async (input: {
  organizationId: string;
  runId: string;
  executedBy: string;
}): Promise<AutomationRunExecutionResult> => {
  try {
    await assertAutonomousRemediationAllowed(input.organizationId);
  } catch (error) {
    if (isEntitlementError(error)) {
      throw error;
    }
    throw error;
  }

  const run = await loadRunOrThrow(input.organizationId, input.runId);
  if (run.executionMode !== "AUTONOMOUS") {
    throw new Error("Run is not in autonomous execution mode");
  }
  if (!["PLANNED", "APPROVAL_PENDING"].includes(run.status)) {
    throw new Error(`Autonomous run cannot start from status ${run.status}`);
  }

  const policy = await evaluateAutomationPolicy(input.organizationId);
  if (!policy.enabled || policy.executionMode !== "AUTONOMOUS") {
    throw new Error("Autonomous automation policy is not enabled");
  }

  const maintenance = await findActiveMaintenanceForService({
    organizationId: input.organizationId,
    projectId: run.projectId,
    serviceId: run.Steps[0]?.targetServiceId
  });
  if (maintenance.inMaintenance && !maintenance.allowAutonomous) {
    throw new Error(`Autonomous automation blocked by maintenance window: ${maintenance.windowName ?? maintenance.windowId}`);
  }

  await prisma.automationRun.update({
    where: { id: run.id },
    data: {
      approvedBy: input.executedBy,
      approvedAt: new Date(),
      approvedVersionId: run.versionId,
      status: "APPROVED",
      updatedAt: new Date()
    }
  });

  return executeApprovedRun({
    organizationId: input.organizationId,
    runId: run.id,
    executedBy: input.executedBy,
    approvalReason: "Autonomous execution of low-risk playbook steps."
  });
};

export const runAutonomousAutomationSweep = async (organizationId?: string): Promise<{
  scanned: number;
  attempted: number;
}> => {
  const runs = await prisma.automationRun.findMany({
    where: {
      executionMode: "AUTONOMOUS",
      status: { in: ["PLANNED", "APPROVAL_PENDING"] },
      ...(organizationId ? { organizationId } : {})
    },
    select: { id: true, organizationId: true },
    take: Number(process.env.AUTOMATION_AUTONOMOUS_SWEEP_LIMIT || 10)
  });

  let attempted = 0;
  for (const run of runs) {
    try {
      await assertAutonomousRemediationAllowed(run.organizationId);
    } catch {
      continue;
    }
    try {
      await executeAutonomousRun({
        organizationId: run.organizationId,
        runId: run.id,
        executedBy: "automation-autonomous-sweep"
      });
      attempted += 1;
    } catch {
      // Failed runs retain status for operator review.
    }
  }

  return { scanned: runs.length, attempted };
};
