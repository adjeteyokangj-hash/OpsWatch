import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { redactUnknown } from "../../lib/redact-secrets";
import { getUniversalAction } from "./action-registry";
import {
  acquireRemediationLock,
  releaseRemediationLock
} from "./remediation-lock.service";
import { ensureRemediationProvidersRegistered } from "./providers/register-providers";
import { getRemediationProvider } from "./provider-adapter";
import type { RemediationContext } from "./types";
import {
  assertCircuitClosed,
  recordCircuitFailure,
  recordCircuitSuccess,
  getCircuitState
} from "./circuit-breaker.service";
import { revalidateApprovedAction } from "./approval.service";
import { recordOperationsTimelineEvent } from "../intelligence/observation.service";
import { TIMELINE_EVENT } from "../intelligence/intelligence-constants";

const STALE_RUNNING_MS = Number(process.env.REMEDIATION_STALE_RUNNING_MS || 15 * 60_000);
const DEFAULT_TIMEOUT_MS = Number(process.env.REMEDIATION_EXECUTION_TIMEOUT_MS || 90_000);

export type CreateExecutionRunInput = {
  context: RemediationContext;
  actionKey: string;
  automationMode: "OBSERVE" | "APPROVAL" | "AUTONOMOUS";
  requestedBy?: string;
  approvedBy?: string;
  approvalId?: string;
  correlationId?: string;
  idempotencyKey?: string;
  connectionId?: string;
};

const timeline = async (input: {
  organizationId: string;
  projectId?: string | null;
  correlationId: string;
  summary: string;
  payload?: Record<string, unknown>;
}) => {
  if (!input.projectId) return;
  try {
    await recordOperationsTimelineEvent({
      organizationId: input.organizationId,
      projectId: input.projectId,
      eventType: TIMELINE_EVENT.AUTOMATION_EXECUTED,
      summary: input.summary,
      sourceType: "REMEDIATION_EXECUTION_RUN",
      sourceId: input.correlationId,
      severity: "info",
      payloadJson: { correlationId: input.correlationId, ...(input.payload ?? {}) }
    });
  } catch {
    // ignore
  }
};

export const createRemediationExecutionRun = async (input: CreateExecutionRunInput) => {
  if (input.automationMode === "OBSERVE") {
    throw new Error("Observe mode never creates an execution run.");
  }

  const def = getUniversalAction(input.actionKey);
  if (!def || !def.enabled) throw new Error("Unknown or disabled action");

  if (input.idempotencyKey) {
    const existing = await prisma.remediationExecutionRun.findFirst({
      where: {
        organizationId: input.context.organizationId,
        idempotencyKey: input.idempotencyKey
      }
    });
    if (existing) return existing;
  }

  const correlationId = input.correlationId ?? randomUUID();
  const connectionId =
    input.connectionId ||
    (typeof input.context.extra?.connectionId === "string"
      ? input.context.extra.connectionId
      : input.context.integrationId) ||
    null;

  let environment: string | null = null;
  if (input.context.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: input.context.projectId, organizationId: input.context.organizationId },
      select: { environment: true }
    });
    environment = project?.environment ?? null;
  }

  const circuit = await getCircuitState({
    organizationId: input.context.organizationId,
    projectId: input.context.projectId,
    actionKey: input.actionKey
  });

  return prisma.remediationExecutionRun.create({
    data: {
      id: randomUUID(),
      correlationId,
      organizationId: input.context.organizationId,
      projectId: input.context.projectId ?? null,
      environment,
      connectionId,
      provider: def.providerType,
      actionKey: input.actionKey,
      alertId: input.context.alertId ?? null,
      incidentId: input.context.incidentId ?? null,
      entityId:
        (typeof input.context.extra?.entityId === "string" && input.context.extra.entityId) || null,
      relationshipId:
        (typeof input.context.extra?.relationshipId === "string" &&
          input.context.extra.relationshipId) ||
        null,
      requestedBy: input.requestedBy ?? null,
      approvedBy: input.approvedBy ?? null,
      approvalId: input.approvalId ?? null,
      automationMode: input.automationMode,
      riskLevel: def.riskLevel,
      status: input.approvalId ? "APPROVED" : "PROPOSED",
      sanitisedInputJson: redactUnknown({
        organizationId: input.context.organizationId,
        projectId: input.context.projectId,
        alertId: input.context.alertId,
        incidentId: input.context.incidentId,
        connectionId,
        note: input.context.note
      }) as object,
      circuitBreakerState: circuit.state,
      idempotencyKey: input.idempotencyKey ?? null,
      updatedAt: new Date()
    }
  });
};

export const cancelRemediationExecutionRun = async (input: {
  organizationId: string;
  runId: string;
  cancelledBy: string;
  reason?: string;
}) => {
  const run = await prisma.remediationExecutionRun.findFirst({
    where: { id: input.runId, organizationId: input.organizationId }
  });
  if (!run) throw new Error("Execution run not found");
  if (["VERIFIED_HEALTHY", "ROLLED_BACK", "CANCELLED", "DEAD_LETTER"].includes(run.status)) {
    throw new Error(`Cannot cancel run in status ${run.status}`);
  }
  return prisma.remediationExecutionRun.update({
    where: { id: run.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledBy: input.cancelledBy,
      failureReason: input.reason ?? "Cancelled by operator",
      endedAt: new Date(),
      updatedAt: new Date()
    }
  });
};

export const recoverStaleRunningRemediationRuns = async (): Promise<number> => {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS);
  const result = await prisma.remediationExecutionRun.updateMany({
    where: {
      status: { in: ["EXECUTING", "VERIFYING", "ROLLBACK_RUNNING"] },
      startedAt: { lte: cutoff }
    },
    data: {
      status: "DEAD_LETTER",
      deadLetterAt: new Date(),
      failureReason: "Stale RUNNING recovery — worker or process restart",
      endedAt: new Date(),
      updatedAt: new Date()
    }
  });
  return result.count;
};

export const executeGovernedRemediation = async (input: {
  context: RemediationContext;
  actionKey: string;
  automationMode: "APPROVAL" | "AUTONOMOUS";
  requestedBy?: string;
  approvalId?: string;
  idempotencyKey?: string;
  skipVerification?: boolean;
  forceRollbackOnVerificationFailure?: boolean;
}) => {
  ensureRemediationProvidersRegistered();
  const def = getUniversalAction(input.actionKey);
  if (!def) throw new Error("Unknown action");

  if (input.automationMode === "AUTONOMOUS") {
    if (def.riskLevel !== "LOW" || def.requiresApproval) {
      throw new Error("Autonomous mode may only execute low-risk pre-approved actions.");
    }
  }

  const circuitGate = await assertCircuitClosed({
    organizationId: input.context.organizationId,
    projectId: input.context.projectId,
    actionKey: input.actionKey
  });
  if (!circuitGate.ok) {
    throw new Error(circuitGate.reason);
  }

  if (input.approvalId) {
    const revalidated = await revalidateApprovedAction({
      organizationId: input.context.organizationId,
      approvalId: input.approvalId,
      context: input.context,
      automationMode: input.automationMode,
      circuitOpen: false
    });
    if (!revalidated.ok) {
      throw new Error(revalidated.reason);
    }
  }

  const run = await createRemediationExecutionRun({
    context: input.context,
    actionKey: input.actionKey,
    automationMode: input.automationMode,
    requestedBy: input.requestedBy,
    approvedBy: input.approvalId
      ? (
          await prisma.remediationApproval.findFirst({
            where: { id: input.approvalId },
            select: { decidedBy: true }
          })
        )?.decidedBy ?? undefined
      : input.requestedBy,
    approvalId: input.approvalId,
    idempotencyKey: input.idempotencyKey
  });

  const lockKey = `remediation-action:${input.context.organizationId}:${input.context.projectId ?? "none"}:${input.actionKey}:${input.context.incidentId ?? input.context.alertId ?? run.id}`;
  const lock = await acquireRemediationLock({
    lockKey,
    organizationId: input.context.organizationId,
    incidentId: input.context.incidentId,
    action: input.actionKey,
    holder: run.id,
    ttlMs: def.timeoutMs || DEFAULT_TIMEOUT_MS
  });
  if (!lock.acquired) {
    await prisma.remediationExecutionRun.update({
      where: { id: run.id },
      data: {
        status: "BLOCKED",
        failureReason: "Action-level lock held by another execution",
        updatedAt: new Date()
      }
    });
    throw new Error("Another administrator is already executing this repair.");
  }

  try {
    await prisma.remediationExecutionRun.update({
      where: { id: run.id },
      data: {
        status: "EXECUTING",
        startedAt: new Date(),
        lockHolder: run.id,
        updatedAt: new Date()
      }
    });

    await timeline({
      organizationId: input.context.organizationId,
      projectId: input.context.projectId,
      correlationId: run.correlationId,
      summary: `Execution started: ${def.displayName}`,
      payload: { runId: run.id, actionKey: input.actionKey }
    });

    const provider = getRemediationProvider(def.providerType);
    if (!provider) throw new Error(`No provider adapter for ${def.providerType}`);

    const timeoutMs = def.timeoutMs || DEFAULT_TIMEOUT_MS;
    const providerResult = await Promise.race([
      provider.executeAction(input.context, {
        actionKey: def.actionKey,
        correlationId: run.correlationId,
        approvalId: input.approvalId,
        approvedBy: run.approvedBy ?? undefined,
        input: (input.context.extra ?? {}) as Record<string, unknown>
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Execution timed out after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);

    await prisma.remediationExecutionRun.update({
      where: { id: run.id },
      data: {
        status: "EXECUTED",
        providerResultJson: redactUnknown(providerResult) as object,
        updatedAt: new Date()
      }
    });

    await timeline({
      organizationId: input.context.organizationId,
      projectId: input.context.projectId,
      correlationId: run.correlationId,
      summary: `Provider response received: ${def.displayName}`,
      payload: { success: providerResult.success, status: providerResult.status }
    });

    if (!providerResult.success) {
      await recordCircuitFailure({
        organizationId: input.context.organizationId,
        projectId: input.context.projectId,
        actionKey: input.actionKey,
        kind: "provider",
        reason: providerResult.summary
      });
      const failed = await prisma.remediationExecutionRun.update({
        where: { id: run.id },
        data: {
          status: "VERIFICATION_FAILED",
          failureReason: providerResult.summary,
          endedAt: new Date(),
          updatedAt: new Date()
        }
      });
      return { run: failed, providerResult, verification: null, rollback: null };
    }

    if (input.skipVerification || def.verificationStrategy === "NONE") {
      await recordCircuitSuccess({
        organizationId: input.context.organizationId,
        projectId: input.context.projectId,
        actionKey: input.actionKey
      });
      const completed = await prisma.remediationExecutionRun.update({
        where: { id: run.id },
        data: {
          status: "VERIFIED_HEALTHY",
          verificationJson: { state: "VERIFIED_HEALTHY", summary: "No verification required" },
          endedAt: new Date(),
          updatedAt: new Date()
        }
      });
      return { run: completed, providerResult, verification: null, rollback: null };
    }

    await prisma.remediationExecutionRun.update({
      where: { id: run.id },
      data: { status: "VERIFYING", updatedAt: new Date() }
    });
    await timeline({
      organizationId: input.context.organizationId,
      projectId: input.context.projectId,
      correlationId: run.correlationId,
      summary: `Verification started: ${def.displayName}`
    });

    const verification = await provider.verifyAction(input.context, {
      actionKey: def.actionKey,
      correlationId: run.correlationId,
      executionRunId: run.id,
      approvalId: input.approvalId,
      approvedBy: run.approvedBy ?? undefined,
      providerResult: (providerResult.details ?? {}) as Record<string, unknown>,
      input: (input.context.extra ?? {}) as Record<string, unknown>
    });

    if (verification.state === "VERIFIED_HEALTHY" || verification.state === "PARTIALLY_RECOVERED") {
      await recordCircuitSuccess({
        organizationId: input.context.organizationId,
        projectId: input.context.projectId,
        actionKey: input.actionKey
      });
      const completed = await prisma.remediationExecutionRun.update({
        where: { id: run.id },
        data: {
          status: verification.state,
          verificationJson: redactUnknown(verification) as object,
          endedAt: new Date(),
          updatedAt: new Date()
        }
      });
      await timeline({
        organizationId: input.context.organizationId,
        projectId: input.context.projectId,
        correlationId: run.correlationId,
        summary:
          verification.state === "VERIFIED_HEALTHY"
            ? `Recovery verified: ${def.displayName}`
            : `Partial recovery: ${def.displayName}`,
        payload: verification.evidence
      });
      return { run: completed, providerResult, verification, rollback: null };
    }

    await recordCircuitFailure({
      organizationId: input.context.organizationId,
      projectId: input.context.projectId,
      actionKey: input.actionKey,
      kind: "verification",
      reason: verification.summary
    });

    await prisma.remediationExecutionRun.update({
      where: { id: run.id },
      data: {
        status: "VERIFICATION_FAILED",
        verificationJson: redactUnknown(verification) as object,
        failureReason: verification.summary,
        updatedAt: new Date()
      }
    });
    await timeline({
      organizationId: input.context.organizationId,
      projectId: input.context.projectId,
      correlationId: run.correlationId,
      summary: `Verification failed: ${def.displayName}`,
      payload: verification.evidence
    });

    let rollback = null;
    if (
      (input.forceRollbackOnVerificationFailure ?? true) &&
      provider.rollbackAction &&
      def.rollbackCapability !== "NONE" &&
      def.rollbackCapability !== "MANUAL_OPERATOR"
    ) {
      await prisma.remediationExecutionRun.update({
        where: { id: run.id },
        data: { status: "ROLLBACK_RUNNING", updatedAt: new Date() }
      });
      await timeline({
        organizationId: input.context.organizationId,
        projectId: input.context.projectId,
        correlationId: run.correlationId,
        summary: `Rollback started: ${def.displayName}`
      });
      rollback = await provider.rollbackAction(input.context, {
        actionKey: def.actionKey,
        correlationId: run.correlationId,
        executionRunId: run.id,
        approvalId: input.approvalId,
        approvedBy: run.approvedBy ?? undefined,
        providerResult: (providerResult.details ?? {}) as Record<string, unknown>
      });
      if (rollback.state === "ROLLBACK_FAILED") {
        await recordCircuitFailure({
          organizationId: input.context.organizationId,
          projectId: input.context.projectId,
          actionKey: input.actionKey,
          kind: "rollback",
          reason: rollback.summary
        });
      }
      const rolled = await prisma.remediationExecutionRun.update({
        where: { id: run.id },
        data: {
          status: rollback.state === "ROLLED_BACK" ? "ROLLED_BACK" : "ROLLBACK_FAILED",
          rollbackResultJson: redactUnknown(rollback) as object,
          endedAt: new Date(),
          updatedAt: new Date()
        }
      });
      await timeline({
        organizationId: input.context.organizationId,
        projectId: input.context.projectId,
        correlationId: run.correlationId,
        summary: `Rollback ${rollback.state}: ${def.displayName}`
      });
      return { run: rolled, providerResult, verification, rollback };
    }

    const failed = await prisma.remediationExecutionRun.update({
      where: { id: run.id },
      data: { endedAt: new Date(), updatedAt: new Date() }
    });
    return { run: failed, providerResult, verification, rollback: null };
  } finally {
    await releaseRemediationLock(lockKey, run.id);
  }
};
