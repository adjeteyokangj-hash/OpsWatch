import { createHash, randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  detectOtelProtocol,
  hashOtelIdempotency,
  normalizeOtelBatch,
  parseOtelBridgePayload,
  type OtelBridgePayload,
  type RejectedSignal
} from "./otel-normalize";
import { resolveOtelServiceEntity } from "./otel-identity.service";
import { sanitizeAuditMetadata } from "./otel-redaction";

export type OtelConnection = {
  id: string;
  organizationId: string;
  projectId: string | null;
  name: string;
  environment?: string;
};

export type OtelIngestResult = {
  batchId: string;
  entityId: string | null;
  accepted: number;
  rejected: RejectedSignal[];
  duplicate: boolean;
  status: string;
};

const batchExpiryMs = (): number =>
  Number(process.env.OPSWATCH_OTEL_BATCH_EXPIRY_MS ?? 7 * 24 * 60 * 60_000);

export const ingestOtelBridgePayload = async (
  connection: OtelConnection,
  payload: OtelBridgePayload,
  options?: { rawBody?: Buffer; payloadBytes?: number; protocol?: "NORMALIZED_JSON" | "OTLP_HTTP_JSON" }
): Promise<OtelIngestResult> => {
  const protocol =
    options?.protocol ??
    (options?.rawBody ? detectOtelProtocol(JSON.parse(options.rawBody.toString("utf8"))) : "NORMALIZED_JSON");
  const idempotencyHash = options?.rawBody
    ? hashOtelIdempotency(connection.id, options.rawBody)
    : createHash("sha256")
        .update(connection.id)
        .update(JSON.stringify(payload))
        .digest("hex");

  const existing = await prisma.otelIngestBatch.findUnique({
    where: {
      connectionId_idempotencyHash: {
        connectionId: connection.id,
        idempotencyHash
      }
    },
    select: { id: true, acceptedCount: true, status: true }
  });
  if (existing) {
    return {
      batchId: existing.id,
      entityId: null,
      accepted: existing.acceptedCount,
      rejected: [],
      duplicate: true,
      status: existing.status
    };
  }

  const normalized = normalizeOtelBatch(payload, { protocol });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + batchExpiryMs());

  let primaryEntityId: string | null = null;
  if (normalized.accepted[0]) {
    const entity = await resolveOtelServiceEntity({
      organizationId: connection.organizationId,
      projectId: connection.projectId,
      draft: normalized.accepted[0]
    });
    primaryEntityId = entity.id;
  }

  const batchId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.otelIngestBatch.create({
      data: {
        id: batchId,
        organizationId: connection.organizationId,
        projectId: connection.projectId,
        connectionId: connection.id,
        environment: payload.resource.deploymentEnvironment ?? connection.environment ?? "unknown",
        protocol,
        idempotencyHash,
        status: "PENDING",
        acceptedCount: normalized.accepted.length,
        rejectedCount: normalized.rejected.length,
        evidenceJson: sanitizeAuditMetadata({
          serviceName: payload.resource.serviceName,
          rejected: normalized.rejected,
          resourceGroups: normalized.resourceGroups
        }) as Prisma.InputJsonValue,
        payloadBytes: options?.payloadBytes ?? options?.rawBody?.length ?? 0,
        expiresAt,
        updatedAt: now
      }
    });

    for (const draft of normalized.accepted) {
      const signalId = randomUUID();
      let sourceEntityId = primaryEntityId;
      if (
        draft.serviceName !== payload.resource.serviceName ||
        !sourceEntityId
      ) {
        const entity = await resolveOtelServiceEntity({
          organizationId: connection.organizationId,
          projectId: connection.projectId,
          draft
        });
        sourceEntityId = entity.id;
        primaryEntityId = primaryEntityId ?? entity.id;
      }

      await tx.normalizedOperationalSignal.create({
        data: {
          id: signalId,
          organizationId: connection.organizationId,
          projectId: connection.projectId,
          connectionId: connection.id,
          batchId,
          signalType: draft.signalType,
          severity: draft.severity ?? null,
          healthImpact: draft.healthImpact,
          sourceEntityId,
          serviceName: draft.serviceName,
          resourceIdentity: draft.resourceIdentity,
          environment: draft.environment,
          traceId: draft.traceId,
          spanId: draft.spanId,
          parentSpanId: draft.parentSpanId,
          metricName: draft.metricName,
          logFingerprint: draft.logFingerprint,
          normalizedStatus: draft.normalizedStatus,
          fingerprint: draft.fingerprint,
          observedAt: draft.observedAt,
          firstSeenAt: draft.observedAt,
          lastSeenAt: draft.observedAt,
          attributesJson: draft.attributes as Prisma.InputJsonValue,
          resourceAttributesJson: draft.resourceAttributes as Prisma.InputJsonValue,
          evidenceBatchId: batchId,
          freshUntil: draft.freshUntil,
          staleAt: draft.freshUntil,
          processingState: "PENDING",
          updatedAt: now
        }
      });

      await tx.operationalObservation.create({
        data: {
          id: randomUUID(),
          organizationId: connection.organizationId,
          projectId: connection.projectId,
          sourceType: "OTEL_COLLECTOR",
          sourceId: connection.id,
          eventKey: `OTEL_${draft.kind}`,
          summary: `${draft.serviceName}: ${draft.name}`,
          severity: draft.severity,
          payloadJson: {
            batchId,
            signalId,
            fingerprint: draft.fingerprint,
            attributes: draft.attributes,
            resource: draft.resourceAttributes,
            correlation: {
              entityId: sourceEntityId,
              traceId: draft.traceId,
              spanId: draft.spanId,
              parentSpanId: draft.parentSpanId
            },
            ...(draft.value !== undefined ? { value: draft.value } : {}),
            ...(draft.body ? { body: draft.body } : {})
          } as Prisma.InputJsonValue,
          observedAt: draft.observedAt
        }
      });

      await tx.operationsTimelineEvent.create({
        data: {
          id: randomUUID(),
          organizationId: connection.organizationId,
          projectId: connection.projectId,
          eventType: `OTEL_${draft.kind}`,
          summary: `${draft.serviceName}: ${draft.name}`,
          sourceType: "OTEL_COLLECTOR",
          sourceId: connection.id,
          severity: draft.severity,
          payloadJson: {
            batchId,
            signalId,
            fingerprint: draft.fingerprint
          } as Prisma.InputJsonValue,
          occurredAt: draft.observedAt
        }
      });
    }

    await tx.connection.update({
      where: { id: connection.id },
      data: {
        health: "HEALTHY",
        healthReason: null,
        installationStatus: "ACTIVE",
        lastSuccessAt: now,
        lastError: null,
        updatedAt: now
      }
    });

    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        organizationId: connection.organizationId,
        action: "OTEL_BRIDGE_ACCEPTED",
        entityType: "CONNECTION",
        entityId: connection.id,
        metadataJson: sanitizeAuditMetadata({
          organizationId: connection.organizationId,
          batchId,
          signalCount: normalized.accepted.length,
          rejectedCount: normalized.rejected.length,
          entityId: primaryEntityId
        }) as Prisma.InputJsonValue
      }
    });
  });

  return {
    batchId,
    entityId: primaryEntityId,
    accepted: normalized.accepted.length,
    rejected: normalized.rejected,
    duplicate: false,
    status: "PENDING"
  };
};

export { parseOtelBridgePayload, hashOtelIdempotency, detectOtelProtocol };
