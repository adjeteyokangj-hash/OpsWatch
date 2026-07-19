import { randomUUID } from "crypto";
import type { IntegrationType, Prisma, RemediatorRepairStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../config/logger";
import { recordOperationsTimelineEvent } from "../intelligence/observation.service";
import { TIMELINE_EVENT } from "../intelligence/intelligence-constants";
import {
  isRemediatorProviderType,
  providerSupportsAction,
  resolveRemediatorActionFromContext,
  type RemediatorAction,
  type RemediatorProviderType
} from "./remediator-actions";
import {
  readRemediatorConfig,
  resolveRemediatorSecret,
  resolveRemediatorSecretAsync,
  withCircuitState
} from "./remediator-config";
import {
  isRemediatorTimestampFresh,
  newIdempotencyKey,
  newRemediatorNonce,
  remediatorSigningHeaders,
  type RemediatorSignedFields
} from "./remediator-signing";
import type { RemediationContext, RemediationExecutionResult } from "./types";
import { completed, failed, misconfigured } from "./executors/_common";

const asJson = (value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue =>
  (value ?? {}) as Prisma.InputJsonValue;

const CIRCUIT_FAILURE_THRESHOLD = Number(process.env.REMEDIATOR_CIRCUIT_FAILURE_THRESHOLD || 3);
const CIRCUIT_OPEN_MS = Number(process.env.REMEDIATOR_CIRCUIT_OPEN_MS || 15 * 60_000);
const VERIFY_WAIT_MS = Number(process.env.REMEDIATOR_VERIFY_WAIT_MS || 0);
const MAX_REPAIR_RETRIES = Number(process.env.REMEDIATOR_MAX_RETRIES || 1);

export type RemediatorRow = {
  id: string;
  type: IntegrationType;
  enabled: boolean;
  configJson: Record<string, unknown> | null;
  secretRef: string | null;
  credentialFamilyId: string | null;
  projectId: string;
  organizationId: string;
  environment: string;
  validationStatus: "UNKNOWN" | "VALID" | "INVALID";
};

export type RemediatorGateFailure =
  | "MISSING_PROVIDER"
  | "UNVALIDATED_PROVIDER"
  | "DISABLED"
  | "EMERGENCY_DISABLED"
  | "MONITORING_ONLY"
  | "INCOMPATIBLE_CAPABILITY"
  | "MISSING_WEBHOOK"
  | "MISSING_SECRET"
  | "CIRCUIT_OPEN"
  | "DUPLICATE_REQUEST"
  | "INVALID_ACTION"
  | "CONFIDENCE_BLOCKED"
  | "POLICY_BLOCKED";

const timelineSummary = (status: RemediatorRepairStatus, action: string): string => {
  const label = action.replaceAll("_", " ");
  switch (status) {
    case "REQUESTED":
      return `Remediator repair requested: ${label}`;
    case "ACCEPTED":
      return `Remediator accepted repair: ${label}`;
    case "REJECTED":
      return `Remediator rejected repair: ${label}`;
    case "RUNNING":
      return `Remediator repair running: ${label}`;
    case "COMPLETED":
      return `Remediator repair completed: ${label}`;
    case "FAILED":
      return `Remediator repair failed: ${label}`;
    case "TIMED_OUT":
      return `Remediator repair timed out: ${label}`;
    case "VERIFICATION_FAILED":
      return `Remediator verification failed after: ${label}`;
    default:
      return `Remediator status ${status}: ${label}`;
  }
};

const emitRemediatorTimeline = async (input: {
  organizationId: string;
  projectId: string;
  attemptId: string;
  status: RemediatorRepairStatus;
  action: string;
  payload?: Record<string, unknown>;
}): Promise<void> => {
  try {
    await recordOperationsTimelineEvent({
      organizationId: input.organizationId,
      projectId: input.projectId,
      eventType: TIMELINE_EVENT.AUTOMATION_EXECUTED,
      summary: timelineSummary(input.status, input.action),
      sourceType: "REMEDIATOR_REPAIR",
      sourceId: input.attemptId,
      severity: input.status === "COMPLETED" ? "info" : "warning",
      payloadJson: {
        remediatorStatus: input.status,
        remediatorAction: input.action,
        ...(input.payload ?? {})
      }
    });
  } catch (error) {
    logger.warn({ err: error, attemptId: input.attemptId }, "Failed to record remediator timeline event");
  }
};

export const loadRemediatorIntegration = async (
  projectId: string,
  organizationId: string,
  providerType: RemediatorProviderType
): Promise<RemediatorRow | null> => {
  const row = await prisma.projectIntegration.findFirst({
    where: {
      projectId,
      type: providerType,
      Project: { organizationId }
    },
    select: {
      id: true,
      type: true,
      enabled: true,
      configJson: true,
      secretRef: true,
      credentialFamilyId: true,
      projectId: true,
      validationStatus: true,
      Project: { select: { organizationId: true, environment: true } }
    }
  });
  if (!row?.Project?.organizationId) return null;
  return {
    id: row.id,
    type: row.type,
    enabled: row.enabled,
    configJson: (row.configJson as Record<string, unknown> | null) ?? null,
    secretRef: row.secretRef,
    credentialFamilyId: row.credentialFamilyId,
    projectId: row.projectId,
    organizationId: row.Project.organizationId,
    environment: row.Project.environment,
    validationStatus: row.validationStatus
  };
};

export const evaluateRemediatorGate = (input: {
  providerType: string;
  integration: RemediatorRow | null;
  action: RemediatorAction | null;
  projectEmergencyDisabled?: boolean;
  confidenceLabel?: string;
  policyBlocked?: boolean;
}): { ok: true } | { ok: false; reason: RemediatorGateFailure; summary: string } => {
  if (!isRemediatorProviderType(input.providerType)) {
    return {
      ok: false,
      reason: "MONITORING_ONLY",
      summary:
        "This integration is monitoring-only and cannot execute remediator repairs. Connect a Worker, Service, or Deployment remediator provider."
    };
  }
  if (!input.integration) {
    return {
      ok: false,
      reason: "MISSING_PROVIDER",
      summary: "No remediator provider is configured for this project."
    };
  }
  if (!input.integration.enabled) {
    return {
      ok: false,
      reason: "DISABLED",
      summary: "Remediator provider is disabled."
    };
  }
  if (input.projectEmergencyDisabled) {
    return {
      ok: false,
      reason: "EMERGENCY_DISABLED",
      summary: "Remediation is emergency-disabled for this project."
    };
  }

  const cfg = readRemediatorConfig(
    input.integration.type,
    input.integration.configJson,
    input.integration.secretRef
  );
  if (cfg.emergencyDisabled) {
    return {
      ok: false,
      reason: "EMERGENCY_DISABLED",
      summary: "Remediator emergency disable switch is on."
    };
  }
  if (input.integration.validationStatus !== "VALID") {
    return {
      ok: false,
      reason: "UNVALIDATED_PROVIDER",
      summary: "Remediator provider must be connected and validated before repair can run."
    };
  }
  if (!cfg.webhookUrl) {
    return {
      ok: false,
      reason: "MISSING_WEBHOOK",
      summary: "Remediator webhook URL is not configured. Cannot claim a successful repair."
    };
  }
  if (
    !input.integration.credentialFamilyId &&
    !resolveRemediatorSecret(input.integration.configJson, input.integration.secretRef)
  ) {
    return {
      ok: false,
      reason: "MISSING_SECRET",
      summary: "Remediator webhook secret is not configured."
    };
  }
  if (!input.action) {
    return {
      ok: false,
      reason: "INVALID_ACTION",
      summary: "Requested remediator action is not allowlisted."
    };
  }
  if (!providerSupportsAction(input.integration.type, input.action, cfg.capabilities)) {
    return {
      ok: false,
      reason: "INCOMPATIBLE_CAPABILITY",
      summary: `Remediator provider does not advertise capability: ${input.action}`
    };
  }
  if (cfg.circuitOpenUntil && cfg.circuitOpenUntil.getTime() > Date.now()) {
    return {
      ok: false,
      reason: "CIRCUIT_OPEN",
      summary: `Remediator circuit breaker is open until ${cfg.circuitOpenUntil.toISOString()}`
    };
  }
  if (input.policyBlocked) {
    return {
      ok: false,
      reason: "POLICY_BLOCKED",
      summary: "Project automation policy blocks remediator execution."
    };
  }
  if (input.confidenceLabel === "BLOCKED" || input.confidenceLabel === "LOW") {
    return {
      ok: false,
      reason: "CONFIDENCE_BLOCKED",
      summary: `Confidence gate blocked remediator execution (${input.confidenceLabel}).`
    };
  }
  return { ok: true };
};

type ValidateHandshakeResult = {
  status: "VALID" | "INVALID";
  message: string;
  capabilities: string[];
  checks: Array<{ id: string; label: string; status: "pass" | "fail" | "warn" | "pending"; detail?: string }>;
};

/** Signed validate handshake used from Integrations "Test connection". */
export const runRemediatorValidationHandshake = async (input: {
  projectId: string;
  providerType: RemediatorProviderType;
  configJson: Record<string, unknown> | null;
  secretRef?: string | null;
  organizationId?: string | null;
  credentialFamilyId?: string | null;
  integrationId?: string | null;
  environment?: string | null;
}): Promise<ValidateHandshakeResult> => {
  const cfg = readRemediatorConfig(input.providerType, input.configJson, input.secretRef);
  const secret = input.organizationId
    ? await resolveRemediatorSecretAsync({
      organizationId: input.organizationId,
      projectId: input.projectId,
      environment: input.environment ?? null,
      credentialFamilyId: input.credentialFamilyId ?? null,
      integrationId: input.integrationId ?? null,
      configJson: input.configJson,
      secretRef: input.secretRef
    })
    : resolveRemediatorSecret(input.configJson, input.secretRef);

  if (!cfg.webhookUrl) {
    return {
      status: "INVALID",
      message: "Missing remediator webhook URL.",
      capabilities: cfg.capabilities,
      checks: [
        { id: "webhook", label: "Webhook URL configured", status: "fail" },
        { id: "secret", label: "Signing secret configured", status: secret ? "pass" : "fail" },
        { id: "handshake", label: "Signed validation handshake", status: "pending" }
      ]
    };
  }
  if (!secret) {
    return {
      status: "INVALID",
      message: "Missing remediator signing secret.",
      capabilities: cfg.capabilities,
      checks: [
        { id: "webhook", label: "Webhook URL configured", status: "pass" },
        { id: "secret", label: "Signing secret configured", status: "fail" },
        { id: "handshake", label: "Signed validation handshake", status: "pending" }
      ]
    };
  }

  const timestamp = new Date().toISOString();
  const nonce = newRemediatorNonce();
  const idempotencyKey = newIdempotencyKey(["validate", input.projectId, nonce]);
  const fields: RemediatorSignedFields = {
    timestamp,
    nonce,
    projectId: input.projectId,
    incidentId: null,
    action: "validate",
    target: null,
    reason: "integration_validation",
    idempotencyKey
  };

  const body = {
    type: "validate",
    ...fields
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const response = await fetch(cfg.webhookUrl, {
      method: "POST",
      headers: remediatorSigningHeaders(secret, fields),
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        status: "INVALID",
        message: `Validation handshake failed (${response.status}).`,
        capabilities: cfg.capabilities,
        checks: [
          { id: "webhook", label: "Webhook URL configured", status: "pass" },
          { id: "secret", label: "Signing secret configured", status: "pass" },
          {
            id: "handshake",
            label: "Signed validation handshake",
            status: "fail",
            detail: `HTTP ${response.status}`
          }
        ]
      };
    }

    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      capabilities?: string[];
      accepted?: boolean;
    };
    const advertised =
      Array.isArray(payload.capabilities) && payload.capabilities.length > 0
        ? payload.capabilities.filter((c): c is string => typeof c === "string")
        : cfg.capabilities;
    const accepted = payload.ok === true || payload.accepted === true;
    if (!accepted) {
      return {
        status: "INVALID",
        message: "Remediator rejected the validation handshake.",
        capabilities: advertised,
        checks: [
          { id: "webhook", label: "Webhook URL configured", status: "pass" },
          { id: "secret", label: "Signing secret configured", status: "pass" },
          {
            id: "handshake",
            label: "Signed validation handshake",
            status: "fail",
            detail: "Provider response did not accept validation"
          }
        ]
      };
    }

    return {
      status: "VALID",
      message: "Remediator connected and validated.",
      capabilities: advertised,
      checks: [
        { id: "webhook", label: "Webhook URL configured", status: "pass" },
        { id: "secret", label: "Signing secret configured", status: "pass" },
        { id: "handshake", label: "Signed validation handshake", status: "pass" },
        {
          id: "capabilities",
          label: "Capabilities advertised",
          status: advertised.length > 0 ? "pass" : "warn",
          detail: advertised.join(", ") || undefined
        }
      ]
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "INVALID",
      message: `Validation handshake error: ${message}`,
      capabilities: cfg.capabilities,
      checks: [
        { id: "webhook", label: "Webhook URL configured", status: "pass" },
        { id: "secret", label: "Signing secret configured", status: "pass" },
        { id: "handshake", label: "Signed validation handshake", status: "fail", detail: message }
      ]
    };
  } finally {
    clearTimeout(timeout);
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const verifyPostRepairHealthy = async (input: {
  projectId: string;
  serviceId?: string;
  providerResponse: Record<string, unknown>;
}): Promise<{ verified: boolean; details: Record<string, unknown> }> => {
  // Prefer explicit verification flags from the remediator (TrueNumeris / mock).
  const verifiedFlag =
    input.providerResponse.verified === true ||
    input.providerResponse.verificationStatus === "healthy" ||
    input.providerResponse.healthy === true;

  if (verifiedFlag) {
    return {
      verified: true,
      details: { source: "provider_response", verified: true }
    };
  }

  if (VERIFY_WAIT_MS > 0) {
    await sleep(VERIFY_WAIT_MS);
  }

  // Local healthy-signal check: recent successful check result on the target service/project.
  const since = new Date(Date.now() - 15 * 60_000);
  const healthyCheck = await prisma.checkResult.findFirst({
    where: {
      status: "PASS",
      checkedAt: { gte: since },
      Check: {
        ...(input.serviceId ? { serviceId: input.serviceId } : {}),
        Service: { projectId: input.projectId }
      }
    },
    select: { id: true, checkedAt: true, status: true },
    orderBy: { checkedAt: "desc" }
  });

  if (healthyCheck) {
    return {
      verified: true,
      details: {
        source: "health_check",
        checkResultId: healthyCheck.id,
        checkedAt: healthyCheck.checkedAt.toISOString()
      }
    };
  }

  // Fall back to provider-reported acceptance only if they include verification evidence.
  const evidence = input.providerResponse.verificationEvidence;
  if (evidence && typeof evidence === "object") {
    return { verified: true, details: { source: "provider_evidence", evidence } };
  }

  return {
    verified: false,
    details: {
      source: "none",
      reason:
        "HTTP success alone is not enough. Provider must return verified/healthy signals or OpsWatch must observe a healthy check."
    }
  };
};

const bumpCircuitOnFailure = async (integration: RemediatorRow): Promise<void> => {
  const cfg = readRemediatorConfig(integration.type, integration.configJson, integration.secretRef);
  const failures = cfg.circuitFailures + 1;
  const openUntil =
    failures >= CIRCUIT_FAILURE_THRESHOLD ? new Date(Date.now() + CIRCUIT_OPEN_MS) : null;
  const nextConfig = withCircuitState(integration.configJson, { failures, openUntil });
  await prisma.projectIntegration.update({
    where: { id: integration.id },
    data: { configJson: nextConfig as object, updatedAt: new Date() }
  });
};

const resetCircuitOnSuccess = async (integration: RemediatorRow): Promise<void> => {
  const cfg = readRemediatorConfig(integration.type, integration.configJson, integration.secretRef);
  if (cfg.circuitFailures === 0 && !cfg.circuitOpenUntil) return;
  const nextConfig = withCircuitState(integration.configJson, { failures: 0, openUntil: null });
  await prisma.projectIntegration.update({
    where: { id: integration.id },
    data: { configJson: nextConfig as object, updatedAt: new Date() }
  });
};

export const executeRemediatorRepair = async (input: {
  registryAction: string;
  context: RemediationContext;
  providerType: RemediatorProviderType;
  confidenceLabel?: string;
  policyBlocked?: boolean;
}): Promise<RemediationExecutionResult> => {
  const projectId = input.context.projectId;
  if (!projectId) {
    return misconfigured("projectId is required for remediator repair.", ["projectId"]);
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId: input.context.organizationId },
    select: { id: true, remediationEmergencyDisabled: true }
  });
  if (!project) {
    return failed("Project not found for remediator repair.");
  }

  const remediatorAction = resolveRemediatorActionFromContext(
    input.registryAction,
    input.context.extra
  );
  const integration = await loadRemediatorIntegration(
    projectId,
    input.context.organizationId,
    input.providerType
  );

  const gate = evaluateRemediatorGate({
    providerType: input.providerType,
    integration,
    action: remediatorAction,
    projectEmergencyDisabled: project.remediationEmergencyDisabled,
    confidenceLabel: input.confidenceLabel,
    policyBlocked: input.policyBlocked === true
  });

  if (!gate.ok) {
    return misconfigured(gate.summary, [gate.reason]);
  }

  if (!integration || !remediatorAction) {
    return misconfigured("Remediator provider misconfigured.", ["MISSING_PROVIDER"]);
  }

  const cfg = readRemediatorConfig(integration.type, integration.configJson, integration.secretRef);
  const secret = await resolveRemediatorSecretAsync({
    organizationId: integration.organizationId,
    projectId: integration.projectId,
    environment: integration.environment,
    credentialFamilyId: integration.credentialFamilyId,
    integrationId: integration.id,
    configJson: integration.configJson,
    secretRef: integration.secretRef
  });
  if (!cfg.webhookUrl || !secret) {
    return misconfigured("Remediator webhook is not configured. Cannot claim success.", [
      "MISSING_CONFIGURATION"
    ]);
  }

  const target =
    (typeof input.context.extra?.target === "string" && input.context.extra.target) ||
    input.context.serviceId ||
    "default";
  const reason =
    (typeof input.context.extra?.reason === "string" && input.context.extra.reason) ||
    `OpsWatch remediation: ${input.registryAction}`;
  const idempotencyKey =
    (typeof input.context.extra?.idempotencyKey === "string" &&
      input.context.extra.idempotencyKey.trim()) ||
    newIdempotencyKey([
      input.context.organizationId,
      projectId,
      input.context.incidentId ?? "",
      remediatorAction,
      target
    ]);

  const existing = await prisma.remediatorRepairAttempt.findUnique({
    where: {
      organizationId_idempotencyKey: {
        organizationId: input.context.organizationId,
        idempotencyKey
      }
    }
  });
  if (existing) {
    return failed("Duplicate remediator repair request blocked by idempotency key.", {
      reason: "DUPLICATE_REQUEST",
      attemptId: existing.id,
      priorStatus: existing.status
    });
  }

  const timestamp = new Date().toISOString();
  if (!isRemediatorTimestampFresh(timestamp)) {
    return failed("Remediator request timestamp failed freshness check.");
  }

  const nonce = newRemediatorNonce();
  const fields: RemediatorSignedFields = {
    timestamp,
    nonce,
    projectId,
    incidentId: input.context.incidentId ?? null,
    action: remediatorAction,
    target,
    reason,
    idempotencyKey
  };

  const requestBody = {
    type: "repair",
    ...fields,
    alertId: input.context.alertId ?? null,
    serviceId: input.context.serviceId ?? null,
    registryAction: input.registryAction
  };

  const attemptId = randomUUID();
  await prisma.remediatorRepairAttempt.create({
    data: {
      id: attemptId,
      organizationId: input.context.organizationId,
      projectId,
      incidentId: input.context.incidentId,
      alertId: input.context.alertId,
      providerType: integration.type,
      remediatorAction,
      target,
      reason,
      idempotencyKey,
      nonce,
      requestTimestamp: new Date(timestamp),
      status: "REQUESTED",
      requestPayloadJson: asJson(requestBody as Record<string, unknown>),
      updatedAt: new Date()
    }
  });

  await emitRemediatorTimeline({
    organizationId: input.context.organizationId,
    projectId,
    attemptId,
    status: "REQUESTED",
    action: remediatorAction
  });

  let lastError: string | null = null;
  let httpStatus: number | null = null;
  let responsePayload: Record<string, unknown> = {};

  for (let attempt = 0; attempt <= MAX_REPAIR_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      await prisma.remediatorRepairAttempt.update({
        where: { id: attemptId },
        data: { status: "RUNNING", updatedAt: new Date() }
      });
      await emitRemediatorTimeline({
        organizationId: input.context.organizationId,
        projectId,
        attemptId,
        status: "RUNNING",
        action: remediatorAction,
        payload: { attempt }
      });

      const response = await fetch(cfg.webhookUrl, {
        method: "POST",
        headers: remediatorSigningHeaders(secret, fields),
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      httpStatus = response.status;
      responsePayload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (response.status === 409 || responsePayload.duplicate === true) {
        await prisma.remediatorRepairAttempt.update({
          where: { id: attemptId },
          data: {
            status: "REJECTED",
            httpStatus,
            responsePayloadJson: asJson(responsePayload),
            failureReason: "Provider reported duplicate / conflict",
            completedAt: new Date(),
            updatedAt: new Date()
          }
        });
        await emitRemediatorTimeline({
          organizationId: input.context.organizationId,
          projectId,
          attemptId,
          status: "REJECTED",
          action: remediatorAction
        });
        await bumpCircuitOnFailure(integration);
        return failed("Remediator rejected duplicate repair request.", {
          reason: "DUPLICATE_REQUEST",
          attemptId,
          httpStatus
        });
      }

      if (response.status === 403 || responsePayload.rejected === true || responsePayload.ok === false) {
        await prisma.remediatorRepairAttempt.update({
          where: { id: attemptId },
          data: {
            status: "REJECTED",
            httpStatus,
            responsePayloadJson: asJson(responsePayload),
            failureReason: String(responsePayload.reason ?? `HTTP ${response.status}`),
            completedAt: new Date(),
            updatedAt: new Date()
          }
        });
        await emitRemediatorTimeline({
          organizationId: input.context.organizationId,
          projectId,
          attemptId,
          status: "REJECTED",
          action: remediatorAction
        });
        await bumpCircuitOnFailure(integration);
        return failed(`Remediator rejected repair (${response.status}).`, {
          reason: "PROVIDER_REJECTION",
          attemptId,
          httpStatus,
          response: responsePayload
        });
      }

      if (!response.ok) {
        lastError = `Remediator HTTP ${response.status}`;
        continue;
      }

      await prisma.remediatorRepairAttempt.update({
        where: { id: attemptId },
        data: {
          status: "ACCEPTED",
          httpStatus,
          responsePayloadJson: asJson(responsePayload),
          updatedAt: new Date()
        }
      });
      await emitRemediatorTimeline({
        organizationId: input.context.organizationId,
        projectId,
        attemptId,
        status: "ACCEPTED",
        action: remediatorAction
      });

      // Never mark fixed on HTTP 200 alone — require verification.
      const verification = await verifyPostRepairHealthy({
        projectId,
        serviceId: input.context.serviceId,
        providerResponse: responsePayload
      });

      if (!verification.verified) {
        await prisma.remediatorRepairAttempt.update({
          where: { id: attemptId },
          data: {
            status: "VERIFICATION_FAILED",
            verificationJson: asJson(verification.details),
            failureReason: "Post-action verification failed",
            completedAt: new Date(),
            updatedAt: new Date()
          }
        });
        await emitRemediatorTimeline({
          organizationId: input.context.organizationId,
          projectId,
          attemptId,
          status: "VERIFICATION_FAILED",
          action: remediatorAction,
          payload: verification.details
        });
        await bumpCircuitOnFailure(integration);
        return failed("Remediator accepted the request but post-action verification failed.", {
          reason: "VERIFICATION_FAILED",
          attemptId,
          httpStatus,
          verification: verification.details
        });
      }

      await prisma.remediatorRepairAttempt.update({
        where: { id: attemptId },
        data: {
          status: "COMPLETED",
          verificationJson: asJson(verification.details),
          completedAt: new Date(),
          updatedAt: new Date()
        }
      });
      await emitRemediatorTimeline({
        organizationId: input.context.organizationId,
        projectId,
        attemptId,
        status: "COMPLETED",
        action: remediatorAction,
        payload: verification.details
      });
      try {
        await recordOperationsTimelineEvent({
          organizationId: input.context.organizationId,
          projectId,
          eventType: TIMELINE_EVENT.RECOVERY_VERIFIED,
          summary: `Recovery verified after ${remediatorAction.replaceAll("_", " ")}`,
          sourceType: "REMEDIATOR_REPAIR",
          sourceId: attemptId,
          severity: "info",
          payloadJson: verification.details
        });
      } catch {
        /* non-fatal */
      }
      await resetCircuitOnSuccess(integration);

      return completed(`Remediator repair completed: ${remediatorAction}`, {
        attemptId,
        remediatorAction,
        httpStatus,
        verification: verification.details,
        response: {
          accepted: true,
          verified: true
        }
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = message.toLowerCase().includes("abort");
      lastError = timedOut ? "Remediator request timed out" : message;
      if (timedOut) {
        await prisma.remediatorRepairAttempt.update({
          where: { id: attemptId },
          data: {
            status: "TIMED_OUT",
            failureReason: lastError,
            completedAt: new Date(),
            updatedAt: new Date()
          }
        });
        await emitRemediatorTimeline({
          organizationId: input.context.organizationId,
          projectId,
          attemptId,
          status: "TIMED_OUT",
          action: remediatorAction
        });
        await bumpCircuitOnFailure(integration);
        return failed(lastError, { reason: "TIMEOUT", attemptId });
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  await prisma.remediatorRepairAttempt.update({
    where: { id: attemptId },
    data: {
      status: "FAILED",
      httpStatus,
      responsePayloadJson: asJson(responsePayload),
      failureReason: lastError ?? "Remediator repair failed",
      completedAt: new Date(),
      updatedAt: new Date()
    }
  });
  await emitRemediatorTimeline({
    organizationId: input.context.organizationId,
    projectId,
    attemptId,
    status: "FAILED",
    action: remediatorAction
  });
  await bumpCircuitOnFailure(integration);
  return failed(lastError ?? "Remediator repair failed", {
    reason: "PROVIDER_FAILURE",
    attemptId,
    httpStatus
  });
};

/** Capability check for topology drawer / Fix with automation. */
export const hasValidatedRemediatorCapability = (input: {
  integrations: Array<{
    projectId: string;
    type: string;
    enabled: boolean;
    validationStatus: string;
    configJson?: Record<string, unknown> | null;
  }>;
  projectId: string;
  requiredAction?: RemediatorAction;
}): boolean => {
  for (const row of input.integrations) {
    if (row.projectId !== input.projectId) continue;
    if (!row.enabled) continue;
    if (row.validationStatus !== "VALID") continue;
    if (!isRemediatorProviderType(row.type)) continue;
    const cfg = readRemediatorConfig(row.type, row.configJson ?? null, null);
    if (cfg.emergencyDisabled) continue;
    if (!cfg.webhookUrl) continue;
    if (input.requiredAction) {
      if (!providerSupportsAction(row.type, input.requiredAction, cfg.capabilities)) continue;
    }
    return true;
  }
  return false;
};
