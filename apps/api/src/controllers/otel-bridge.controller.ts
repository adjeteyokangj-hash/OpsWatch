import { createHash, randomUUID } from "crypto";
import type { Request, Response } from "express";
import { logger } from "../config/logger";
import { prisma } from "../lib/prisma";
import {
  parseIngestTimestampMs,
  timingSafeEqualString,
  verifyIngestSignature,
  type RawBodyRequest
} from "../lib/request-signature";
import { resolveConnectionSecretReference } from "../services/agentless-connection.service";
import { acceptIngestNonce } from "../services/ingest-replay.service";
import {
  ingestOtelBridgePayload,
  isOtelIngestionEnabled,
  otelPayloadLimitBytes,
  parseOtelBridgePayload
} from "../services/otel-bridge.service";

const timestampWindowMs = (): number => Number(process.env.INGEST_TIMESTAMP_WINDOW_SECONDS || 300) * 1000;
const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const reject = async (
  req: Request,
  res: Response,
  status: number,
  code: string,
  error: string,
  connection?: { id: string; organizationId: string }
): Promise<void> => {
  logger.warn("otel-bridge: rejected request", { code, requestId: req.header("x-request-id"), connectionId: connection?.id });
  if (connection) {
    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        action: "OTEL_BRIDGE_REJECTED",
        entityType: "CONNECTION",
        entityId: connection.id,
        metadataJson: { organizationId: connection.organizationId, code, requestId: req.header("x-request-id") ?? null }
      }
    });
  }
  res.status(status).json({ error, code });
};

export const ingestOtelBridge = async (req: Request, res: Response): Promise<void> => {
  // This is a Collector bridge, not an OTLP receiver. Disabled is deliberately
  // checked before lookup/authentication so no telemetry is accepted by default.
  if (!isOtelIngestionEnabled()) {
    await reject(req, res, 503, "OTEL_INGESTION_DISABLED", "OpenTelemetry collector ingestion is disabled");
    return;
  }

  const rawBody = (req as Request & RawBodyRequest).rawBody;
  if (!rawBody || rawBody.length === 0 || rawBody.length > otelPayloadLimitBytes()) {
    await reject(req, res, 413, "OTEL_PAYLOAD_REJECTED", "Telemetry payload is missing or exceeds the configured limit");
    return;
  }

  const connection = await prisma.connection.findFirst({
    where: { id: req.params.connectionId, mode: "OTEL_COLLECTOR", isActive: true },
    select: { id: true, organizationId: true, projectId: true, name: true, environment: true, configurationJson: true, secretRef: true }
  });
  if (!connection) {
    await reject(req, res, 404, "OTEL_CONNECTION_NOT_FOUND", "Active OpenTelemetry collector connection not found");
    return;
  }

  const timestamp = req.header("x-opswatch-timestamp")?.trim();
  const nonce = req.header("x-opswatch-nonce")?.trim();
  const signature = req.header("x-opswatch-signature")?.trim();
  const connectionKey = req.header("x-opswatch-connection-key")?.trim();
  const secret = resolveConnectionSecretReference(connection.secretRef);
  if (!secret) {
    await reject(req, res, 401, "OTEL_AUTH_INVALID", "Signed OpenTelemetry collector request headers are required", connection);
    return;
  }
  let replayNonce: string;
  if (timestamp && nonce && signature) {
    const timestampMs = parseIngestTimestampMs(timestamp);
    if (timestampMs === null || Math.abs(Date.now() - timestampMs) > timestampWindowMs()) {
      await reject(req, res, 401, "OTEL_TIMESTAMP_INVALID", "OpenTelemetry collector request timestamp is invalid or stale", connection);
      return;
    }
    if (!verifyIngestSignature(secret, rawBody, { timestamp, nonce, signature })) {
      await reject(req, res, 401, "OTEL_AUTH_INVALID", "Invalid OpenTelemetry collector request signature", connection);
      return;
    }
    replayNonce = nonce;
  } else if (connectionKey && timingSafeEqualString(connectionKey, secret)) {
    // Stock Collector HTTP exporters cannot calculate per-request HMACs. The
    // static connection credential is paired with a body digest replay key.
    replayNonce = `otel-body:${createHash("sha256").update(rawBody).digest("hex")}`;
  } else {
    await reject(req, res, 401, "OTEL_AUTH_INVALID", "Valid signed headers or collector connection credential is required", connection);
    return;
  }
  if (await acceptIngestNonce({ nonce: replayNonce, route: "otel-bridge", projectId: connection.projectId ?? undefined }) === "replay") {
    await reject(req, res, 409, "OTEL_REPLAY", "Replayed OpenTelemetry collector request", connection);
    return;
  }

  const parsed = parseOtelBridgePayload(req.body);
  if (!parsed.value) {
    await reject(req, res, 400, "OTEL_CONTRACT_INVALID", parsed.error ?? "Invalid normalized telemetry contract", connection);
    return;
  }
  const configuredServiceName = asObject(connection.configurationJson)?.serviceName;
  if (
    typeof configuredServiceName !== "string" ||
    configuredServiceName !== parsed.value.resource.serviceName ||
    !parsed.value.resource.deploymentEnvironment ||
    parsed.value.resource.deploymentEnvironment.toLowerCase() !== connection.environment.toLowerCase()
  ) {
    await reject(req, res, 403, "OTEL_RESOURCE_IDENTITY_REJECTED", "Telemetry resource identity does not match this collector connection", connection);
    return;
  }
  const result = await ingestOtelBridgePayload(connection, parsed.value);
  res.status(202).json({ accepted: true, signalsAccepted: result.accepted, entityId: result.entityId });
};
