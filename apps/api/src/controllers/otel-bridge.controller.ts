import { createHash, randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { logger } from "../config/logger";
import { prisma } from "../lib/prisma";
import {
  parseIngestTimestampMs,
  timingSafeEqualString,
  verifyIngestSignature,
  type RawBodyRequest
} from "../lib/request-signature";
import { acceptIngestNonce } from "../services/ingest-replay.service";
import {
  getOtelFeatureFlags,
  ingestOtelBridgePayload,
  isOtelIngestionEnabled,
  otelPayloadLimitBytes,
  parseOtelBridgePayload
} from "../services/otel-bridge.service";
import { detectOtelProtocol } from "../services/otel/otel-normalize";
import { processOtelBatch } from "../services/otel/otel-process.service";
import { sanitizeAuditMetadata } from "../services/otel/otel-redaction";
import {
  recordConnectionCredentialProbe,
  resolveIngestSecrets
} from "../services/credentials/connection-credential.service";

const timestampWindowMs = (): number =>
  Number(process.env.INGEST_TIMESTAMP_WINDOW_SECONDS || 300) * 1000;
const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const reject = async (
  req: Request,
  res: Response,
  status: number,
  code: string,
  error: string,
  connection?: { id: string; organizationId: string }
): Promise<void> => {
  logger.warn("otel-bridge: rejected request", {
    code,
    requestId: req.header("x-request-id"),
    connectionId: connection?.id
  });
  if (connection) {
    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        organizationId: connection.organizationId,
        action: "OTEL_BRIDGE_REJECTED",
        entityType: "CONNECTION",
        entityId: connection.id,
        metadataJson: sanitizeAuditMetadata({
          organizationId: connection.organizationId,
          code,
          requestId: req.header("x-request-id") ?? null
        }) as Prisma.InputJsonValue
      }
    });
  }
  res.status(status).json({ error, code, features: getOtelFeatureFlags() });
};

const verifyWithAnySecret = (
  secrets: string[],
  rawBody: Buffer,
  headers: { timestamp: string; nonce: string; signature: string }
): boolean => secrets.some((secret) => verifyIngestSignature(secret, rawBody, headers));

const matchConnectionKey = (secrets: string[], connectionKey: string): boolean =>
  secrets.some((secret) => timingSafeEqualString(connectionKey, secret));

export const ingestOtelBridge = async (req: Request, res: Response): Promise<void> => {
  if (!isOtelIngestionEnabled()) {
    await reject(req, res, 503, "OTEL_INGESTION_DISABLED", "OpenTelemetry collector ingestion is disabled");
    return;
  }

  const rawBody = (req as Request & RawBodyRequest).rawBody;
  if (!rawBody || rawBody.length === 0 || rawBody.length > otelPayloadLimitBytes()) {
    await reject(
      req,
      res,
      413,
      "OTEL_PAYLOAD_REJECTED",
      "Telemetry payload is missing or exceeds the configured limit"
    );
    return;
  }

  const connection = await prisma.connection.findFirst({
    where: { id: req.params.connectionId, mode: "OTEL_COLLECTOR", isActive: true },
    select: {
      id: true,
      organizationId: true,
      projectId: true,
      name: true,
      environment: true,
      configurationJson: true,
      credentialFamilyId: true,
      secretRef: true,
      managedSecretCiphertext: true,
      managedSecretIv: true,
      managedSecretAuthTag: true
    }
  });
  if (!connection) {
    await reject(req, res, 404, "OTEL_CONNECTION_NOT_FOUND", "Active OpenTelemetry collector connection not found");
    return;
  }

  const timestamp = req.header("x-opswatch-timestamp")?.trim();
  const nonce = req.header("x-opswatch-nonce")?.trim();
  const signature = req.header("x-opswatch-signature")?.trim();
  const connectionKey = req.header("x-opswatch-connection-key")?.trim();
  const secrets = await resolveIngestSecrets(connection);
  if (secrets.length === 0) {
    await recordConnectionCredentialProbe(connection, { succeeded: false });
    await reject(
      req,
      res,
      401,
      "OTEL_AUTH_INVALID",
      "Signed OpenTelemetry collector request headers are required",
      connection
    );
    return;
  }

  let replayNonce: string;
  let authOk = false;
  if (timestamp && nonce && signature) {
    const timestampMs = parseIngestTimestampMs(timestamp);
    if (timestampMs === null || Math.abs(Date.now() - timestampMs) > timestampWindowMs()) {
      await recordConnectionCredentialProbe(connection, { succeeded: false });
      await reject(
        req,
        res,
        401,
        "OTEL_TIMESTAMP_INVALID",
        "OpenTelemetry collector request timestamp is invalid or stale",
        connection
      );
      return;
    }
    authOk = verifyWithAnySecret(secrets, rawBody, { timestamp, nonce, signature });
    replayNonce = nonce;
  } else if (connectionKey && matchConnectionKey(secrets, connectionKey)) {
    authOk = true;
    replayNonce = `otel-body:${createHash("sha256").update(rawBody).digest("hex")}`;
  } else {
    await recordConnectionCredentialProbe(connection, { succeeded: false });
    await reject(
      req,
      res,
      401,
      "OTEL_AUTH_INVALID",
      "Valid signed headers or collector connection credential is required",
      connection
    );
    return;
  }

  if (!authOk) {
    await recordConnectionCredentialProbe(connection, { succeeded: false });
    await reject(req, res, 401, "OTEL_AUTH_INVALID", "Invalid OpenTelemetry collector request signature", connection);
    return;
  }

  // Validate contract/identity before consuming the replay nonce.
  const parsed = parseOtelBridgePayload(req.body);
  if (!parsed.value) {
    await reject(
      req,
      res,
      400,
      "OTEL_CONTRACT_INVALID",
      parsed.error ?? "Invalid normalized telemetry contract",
      connection
    );
    return;
  }
  const configuredServiceName = asObject(connection.configurationJson)?.serviceName;
  if (
    typeof configuredServiceName !== "string" ||
    configuredServiceName !== parsed.value.resource.serviceName ||
    !parsed.value.resource.deploymentEnvironment ||
    parsed.value.resource.deploymentEnvironment.toLowerCase() !== connection.environment.toLowerCase()
  ) {
    await reject(
      req,
      res,
      403,
      "OTEL_RESOURCE_IDENTITY_REJECTED",
      "Telemetry resource identity does not match this collector connection",
      connection
    );
    return;
  }

  if (
    (await acceptIngestNonce({
      nonce: replayNonce,
      route: "otel-bridge",
      projectId: connection.projectId ?? undefined,
      connectionId: connection.id
    })) === "replay"
  ) {
    await reject(req, res, 409, "OTEL_REPLAY", "Replayed OpenTelemetry collector request", connection);
    return;
  }

  try {
    const result = await ingestOtelBridgePayload(connection, parsed.value, {
      rawBody,
      payloadBytes: rawBody.length,
      protocol: detectOtelProtocol(req.body)
    });
    if (!result.duplicate) {
      // Advance the operational spine immediately; worker retries failures.
      await processOtelBatch(result.batchId);
    }
    await recordConnectionCredentialProbe(connection, { succeeded: true });
    const batch = await prisma.otelIngestBatch.findUnique({
      where: { id: result.batchId },
      select: { status: true }
    });
    res.status(202).json({
      accepted: true,
      batchId: result.batchId,
      signalsAccepted: result.accepted,
      signalsRejected: result.rejected,
      duplicate: result.duplicate,
      entityId: result.entityId,
      status: batch?.status ?? result.status,
      features: getOtelFeatureFlags()
    });
  } catch (error) {
    await recordConnectionCredentialProbe(connection, { succeeded: false });
    logger.error("otel-bridge: ingest failed", { error, connectionId: connection.id });
    await reject(req, res, 500, "OTEL_INGEST_FAILED", "Failed to persist telemetry batch", connection);
  }
};
