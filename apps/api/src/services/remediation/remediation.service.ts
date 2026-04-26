import { prisma } from "../../lib/prisma";
import { randomUUID } from "crypto";
import { logger } from "../../config/logger";
import {
  getActionState,
  REMEDIATION_REGISTRY,
  RemediationAction,
  requiresApproval,
  scoreActionConfidence,
  validateContext
} from "./actions";
import {
  RemediationContext,
  RemediationExecutionResult,
  RemediationExecutor
} from "./types";
import { executeRetryWebhooks } from "./executors/retry-webhooks.executor";
import { executeRetryEmails } from "./executors/retry-emails.executor";
import { executeRetryPaymentVerification } from "./executors/retry-payment-verification.executor";
import { executeRequeueFailedJob } from "./executors/requeue-failed-job.executor";
import { executeRerunHttpCheck } from "./executors/rerun-http-check.executor";
import { executeRerunSslCheck } from "./executors/rerun-ssl-check.executor";
import { executeAcknowledgeIncident } from "./executors/acknowledge-incident.executor";
import { executeAddIncidentNote } from "./executors/add-incident-note.executor";
import { executeRestartWorker } from "./executors/restart-worker.executor";
import { executeRestartService } from "./executors/restart-service.executor";
import { executeRollbackDeployment } from "./executors/rollback-deployment.executor";
import { executeDisableIntegration } from "./executors/disable-integration.executor";
import { executeRotateWebhookSecret } from "./executors/rotate-webhook-secret.executor";
import { executeCheckProviderStatus } from "./executors/check-provider-status.executor";
import { executeOpenRunbook } from "./executors/open-runbook.executor";
import { executeRequestHumanReview } from "./executors/request-human-review.executor";

const AUTO_REMEDIATION_ENABLED =
  process.env.AUTO_REMEDIATION_ENABLED !== "false";
const MAX_AUTO_RETRY_ATTEMPTS = Number(process.env.REMEDIATION_MAX_AUTO_RETRIES || 3);
const RETRY_BASE_DELAY_MS = Number(process.env.REMEDIATION_RETRY_BASE_DELAY_MS || 5000);

const NON_RETRYABLE_ACTIONS = new Set<RemediationAction>([
  "ADD_INCIDENT_NOTE",
  "ACKNOWLEDGE_INCIDENT",
  "OPEN_RUNBOOK",
  "REQUEST_HUMAN_REVIEW"
]);

const computeRetryPolicy = (
  action: RemediationAction,
  context: RemediationContext
): {
  eligible: boolean;
  attempt: number;
  maxAttempts: number;
  nextRetryAt?: string;
  backoffMs?: number;
} => {
  const attempt = Number(context.extra?.retryAttempt ?? 0);
  const eligible = !NON_RETRYABLE_ACTIONS.has(action) && attempt < MAX_AUTO_RETRY_ATTEMPTS;
  if (!eligible) {
    return {
      eligible: false,
      attempt,
      maxAttempts: MAX_AUTO_RETRY_ATTEMPTS
    };
  }

  const backoffMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  const nextRetryAt = new Date(Date.now() + backoffMs).toISOString();

  return {
    eligible: true,
    attempt,
    maxAttempts: MAX_AUTO_RETRY_ATTEMPTS,
    nextRetryAt,
    backoffMs
  };
};

const withRetryPolicyDetails = (
  action: RemediationAction,
  context: RemediationContext,
  result: RemediationExecutionResult
): RemediationExecutionResult => {
  if (result.status !== "FAILED") {
    return result;
  }

  const retryPolicy = computeRetryPolicy(action, context);
  return {
    ...result,
    details: {
      ...(result.details ?? {}),
      retryPolicy
    }
  };
};

const emitEscalationHook = async (input: {
  action: RemediationAction;
  context: RemediationContext;
  executedBy?: string;
  result: RemediationExecutionResult;
  logId: string;
}): Promise<void> => {
  if (input.result.status !== "MISCONFIGURED_ENV" && input.result.status !== "FAILED") {
    return;
  }

  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      userId: input.executedBy ?? null,
      action:
        input.result.status === "MISCONFIGURED_ENV"
          ? "REMEDIATION_ESCALATION_MISCONFIGURED_ENV"
          : "REMEDIATION_ESCALATION_FAILED",
      entityType: "REMEDIATION_LOG",
      entityId: input.logId,
      metadataJson: {
        remediationAction: input.action,
        organizationId: input.context.organizationId,
        projectId: input.context.projectId,
        incidentId: input.context.incidentId,
        alertId: input.context.alertId,
        status: input.result.status,
        missingEnvVars: input.result.missingEnvVars,
        retryPolicy: input.result.details?.retryPolicy ?? null,
        confidenceSnapshot: input.result.details?.confidenceSnapshot ?? null,
        summary: input.result.summary
      }
    }
  });
};

const executors: Record<RemediationAction, RemediationExecutor> = {
  RETRY_WEBHOOKS: executeRetryWebhooks,
  RETRY_EMAILS: executeRetryEmails,
  RETRY_PAYMENT_VERIFICATION: executeRetryPaymentVerification,
  REQUEUE_FAILED_JOB: executeRequeueFailedJob,
  RERUN_HTTP_CHECK: executeRerunHttpCheck,
  RERUN_SSL_CHECK: executeRerunSslCheck,
  ACKNOWLEDGE_INCIDENT: executeAcknowledgeIncident,
  ADD_INCIDENT_NOTE: executeAddIncidentNote,
  RESTART_WORKER: executeRestartWorker,
  RESTART_SERVICE: executeRestartService,
  ROLLBACK_DEPLOYMENT: executeRollbackDeployment,
  DISABLE_INTEGRATION: executeDisableIntegration,
  ROTATE_WEBHOOK_SECRET: executeRotateWebhookSecret,
  CHECK_PROVIDER_STATUS: executeCheckProviderStatus,
  OPEN_RUNBOOK: executeOpenRunbook,
  REQUEST_HUMAN_REVIEW: executeRequestHumanReview
};

export interface ExecuteRemediationOutput {
  action: RemediationAction;
  logId: string;
  result: RemediationExecutionResult;
}

export type ExecutionMode = "MANUAL" | "APPROVED" | "AUTOMATIC";

export async function executeRemediation(
  action: RemediationAction,
  context: RemediationContext,
  opts: { approved?: boolean; executedBy?: string; auto?: boolean; executionMode?: ExecutionMode; policySnapshot?: Record<string, unknown>; suppressionSnapshot?: Record<string, unknown> } = {}
): Promise<ExecuteRemediationOutput> {
  const resolvedMode: ExecutionMode = opts.executionMode ?? (opts.auto ? "AUTOMATIC" : opts.approved ? "APPROVED" : "MANUAL");
  if (!AUTO_REMEDIATION_ENABLED) {
    throw new Error(
      "Auto-remediation is disabled (AUTO_REMEDIATION_ENABLED=false)."
    );
  }

  const def = REMEDIATION_REGISTRY[action];
  if (!def) {
    throw new Error(`Unknown remediation action: ${action}`);
  }

  const projectIntegrations = context.projectId
    ? await prisma.projectIntegration.findMany({
        where: {
          projectId: context.projectId,
          enabled: true,
          Project: { organizationId: context.organizationId }
        },
        select: { type: true, enabled: true, configJson: true, validationStatus: true, lastValidatedAt: true }
      })
    : [];

  const normalizedIntegrations = projectIntegrations.map((row) => ({
    type: row.type,
    enabled: row.enabled,
    configJson: (row.configJson as Record<string, unknown> | null) ?? null,
    validationStatus: row.validationStatus,
    lastValidatedAt: row.lastValidatedAt
  }));

  const [succeeded, failed] = await Promise.all([
    prisma.remediationLog.count({
      where: {
        organizationId: context.organizationId,
        action,
        status: "SUCCEEDED"
      }
    }),
    prisma.remediationLog.count({
      where: {
        organizationId: context.organizationId,
        action,
        status: "FAILED"
      }
    })
  ]);
  const totalExecutions = succeeded + failed;
  const historicalSuccessRate = totalExecutions > 0 ? succeeded / totalExecutions : null;

  const state = getActionState(action, context, normalizedIntegrations);
  const requiredType = def.requiredIntegration?.type;
  const requiredIntegration = requiredType
    ? projectIntegrations.find((row) => row.type === requiredType)
    : undefined;
  const confidence = scoreActionConfidence({
    action,
    state,
    severity: context.extra?.severity as string | undefined,
    integrationValidationStatus: requiredIntegration?.validationStatus,
    lastValidatedAt: requiredIntegration?.lastValidatedAt,
    historicalSuccessRate
  });
  const confidenceSnapshot = {
    confidenceScore: confidence.confidenceScore,
    confidenceLabel: confidence.confidenceLabel,
    confidenceFactors: confidence.factors,
    policyTier: def.policyTier,
    autoRunEligible:
      def.policyTier === "SAFE_AUTOMATIC" &&
      state === "READY" &&
      confidence.confidenceLabel === "HIGH",
    state,
    historicalSuccessRate,
    integrationValidationStatus: requiredIntegration?.validationStatus ?? null,
    lastValidatedAt: requiredIntegration?.lastValidatedAt ?? null
  };

  const withConfidenceSnapshot = (result: RemediationExecutionResult): RemediationExecutionResult => ({
    ...result,
    details: {
      ...(result.details ?? {}),
      confidenceSnapshot
    }
  });

  const validation = validateContext(
    action,
    context,
    normalizedIntegrations
  );

  if (validation.missingFields.length > 0 || validation.missingEnvVars.length > 0) {
    const validationResult: RemediationExecutionResult =
      validation.missingFields.length > 0
        ? {
            success: false,
            status: "MISSING_CONTEXT",
            summary: "Missing required context fields.",
            missingFields: validation.missingFields
          }
        : {
            success: false,
            status: "MISCONFIGURED_ENV",
            summary: validation.invalidIntegration
              ? "Integration exists but failed validation."
              : "Required project integration configuration is missing.",
            missingEnvVars: validation.missingEnvVars
          };

    const policyResult = withConfidenceSnapshot(
      withRetryPolicyDetails(action, context, validationResult)
    );

    const log = await prisma.remediationLog.create({
      data: {
        id: randomUUID(),
        organizationId: context.organizationId,
        alertId: context.alertId,
        incidentId: context.incidentId,
        serviceId: context.serviceId,
        projectId: context.projectId,
        action,
        contextJson: context as any,
        executedBy: opts.executedBy,
        status:
          policyResult.status === "MISSING_CONTEXT"
            ? "MISSING_CONTEXT"
            : "MISCONFIGURED_ENV",
        resultJson: policyResult as any,
        updatedAt: new Date()
      }
    });

    await emitEscalationHook({
      action,
      context,
      executedBy: opts.executedBy,
      result: policyResult,
      logId: log.id
    });

    return { action, logId: log.id, result: policyResult };
  }

  if (opts.auto === true && !confidenceSnapshot.autoRunEligible) {
    // Hard guardrails for auto-run (backend enforcement, not UI)
    // ALL three conditions must be true:
    // 1. state === 'READY' ✓
    // 2. policyTier === 'SAFE_AUTOMATIC' ✓
    // 3. confidenceLabel === 'HIGH' ✓
    // If any condition fails, block auto-execution.
    const failureReasons: string[] = [];
    if (confidenceSnapshot.state !== "READY") failureReasons.push(`state is ${confidenceSnapshot.state}, not READY`);
    if (confidenceSnapshot.policyTier !== "SAFE_AUTOMATIC") failureReasons.push(`policyTier is ${confidenceSnapshot.policyTier}, not SAFE_AUTOMATIC`);
    if (confidenceSnapshot.confidenceLabel !== "HIGH") failureReasons.push(`confidenceLabel is ${confidenceSnapshot.confidenceLabel}, not HIGH (score: ${confidenceSnapshot.confidenceScore})`);

    const result = withConfidenceSnapshot({
      success: false,
      status: "PENDING_APPROVAL",
      summary: `Auto-run blocked: ${failureReasons.join("; ")}`,
      details: {
        reason: "AUTO_RUN_INELIGIBLE",
        blockedBy: failureReasons
      }
    });

    const log = await prisma.remediationLog.create({
      data: {
        id: randomUUID(),
        organizationId: context.organizationId,
        alertId: context.alertId,
        incidentId: context.incidentId,
        serviceId: context.serviceId,
        projectId: context.projectId,
        action,
        contextJson: context as any,
        executedBy: opts.executedBy,
        status: "PENDING_APPROVAL",
        resultJson: result as any,
        executionMode: resolvedMode,
        policySnapshot: (opts.policySnapshot ?? null) as any,
        suppressionSnapshot: (opts.suppressionSnapshot ?? null) as any,
        updatedAt: new Date()
      }
    });

    return { action, logId: log.id, result };
  }

  if (requiresApproval(action) && !opts.approved) {
    const result = withConfidenceSnapshot({
      success: false,
      status: "PENDING_APPROVAL",
      summary: "Approval required before execution.",
      details: { group: def.group, kind: def.kind, policyTier: def.policyTier }
    });

    const log = await prisma.remediationLog.create({
      data: {
        id: randomUUID(),
        organizationId: context.organizationId,
        alertId: context.alertId,
        incidentId: context.incidentId,
        serviceId: context.serviceId,
        projectId: context.projectId,
        action,
        contextJson: context as any,
        executedBy: opts.executedBy,
        status: "PENDING_APPROVAL",
        resultJson: result as any,
        executionMode: resolvedMode,
        policySnapshot: (opts.policySnapshot ?? null) as any,
        suppressionSnapshot: (opts.suppressionSnapshot ?? null) as any,
        updatedAt: new Date()
      }
    });

    return { action, logId: log.id, result };
  }

  const log = await prisma.remediationLog.create({
    data: {
      id: randomUUID(),
      organizationId: context.organizationId,
      alertId: context.alertId,
      incidentId: context.incidentId,
      serviceId: context.serviceId,
      projectId: context.projectId,
      action,
      contextJson: context as any,
      executedBy: opts.executedBy,
      status: "EXECUTING",
      // Record prediction at execution time for accuracy tracking
      predictedLabel: confidenceSnapshot.confidenceLabel,
      predictedScore: confidenceSnapshot.confidenceScore,
      impactTier: def.impactTier,
      executionMode: resolvedMode,
      policySnapshot: (opts.policySnapshot ?? null) as any,
      suppressionSnapshot: (opts.suppressionSnapshot ?? null) as any,
      updatedAt: new Date()
    }
  });

  const executor = executors[action];
  if (!executor) {
    const result: RemediationExecutionResult = withConfidenceSnapshot({
      success: false,
      status: "UNSUPPORTED",
      summary: `No executor is implemented for action ${action}.`
    });

    await prisma.remediationLog.update({
      where: { id: log.id },
      data: { status: "FAILED", resultJson: result as any }
    });

    return { action, logId: log.id, result };
  }

  try {
    const executedResult = await executor({ context, executedBy: opts.executedBy });
    const result = withConfidenceSnapshot(
      withRetryPolicyDetails(action, context, executedResult)
    );

    const dbStatus: import("@prisma/client").RemediationStatus =
      result.status === "COMPLETED" ? "SUCCEEDED" :
      result.status === "PENDING_APPROVAL" ? "PENDING_APPROVAL" :
      result.status === "MISSING_CONTEXT" ? "MISSING_CONTEXT" :
      result.status === "MISCONFIGURED_ENV" ? "MISCONFIGURED_ENV" :
      "FAILED";

    await prisma.remediationLog.update({
      where: { id: log.id },
      data: {
        status: dbStatus,
        executedAt: result.success ? new Date() : undefined,
        approvedBy: opts.approved ? opts.executedBy : undefined,
        resultJson: result as any
      }
    });

    await emitEscalationHook({
      action,
      context,
      executedBy: opts.executedBy,
      result,
      logId: log.id
    });

    if (result.success) {
      logger.info({ action, context, result }, `Remediation COMPLETED: ${action}`);
    } else {
      logger.warn({ action, context, result }, `Remediation ${result.status}: ${action}`);
    }

    return { action, logId: log.id, result };
  } catch (error: any) {
    const rawResult: RemediationExecutionResult = {
      success: false,
      status: "FAILED",
      summary: error?.message ?? String(error)
    };
    const result = withConfidenceSnapshot(
      withRetryPolicyDetails(action, context, rawResult)
    );

    await prisma.remediationLog.update({
      where: { id: log.id },
      data: { status: "FAILED", resultJson: result as any }
    });

    await emitEscalationHook({
      action,
      context,
      executedBy: opts.executedBy,
      result,
      logId: log.id
    });

    logger.error({ action, context, error }, `Remediation FAILED: ${action}`);
    return { action, logId: log.id, result };
  }
}
