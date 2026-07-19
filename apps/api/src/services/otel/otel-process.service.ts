import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { applyOtelPolicyAlert } from "./otel-alert.service";
import { recordOtelDependencyEvidence } from "./otel-dependency.service";
import {
  resolveOtelDependencyEntity,
  resolveOtelInstanceEntity,
  resolveOtelServiceEntity
} from "./otel-identity.service";
import type { NormalizedSignalDraft, OtelSignalKind } from "./otel-normalize";
import { isOtelTopologyDiscoveryEnabled } from "./otel-feature-flags";

export { processOtelFreshness } from "./otel-freshness.service";

const maxBatchRetries = (): number =>
  Number(process.env.OPSWATCH_OTEL_MAX_BATCH_RETRIES ?? 5);

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const draftFromSignal = (signal: {
  signalType: string;
  severity: string | null;
  healthImpact: string;
  serviceName: string | null;
  resourceIdentity: string | null;
  environment: string | null;
  traceId: string | null;
  spanId: string | null;
  parentSpanId: string | null;
  metricName: string | null;
  logFingerprint: string | null;
  normalizedStatus: string | null;
  fingerprint: string;
  observedAt: Date;
  freshUntil: Date | null;
  attributesJson: unknown;
  resourceAttributesJson: unknown;
}): NormalizedSignalDraft => {
  const kind: OtelSignalKind =
    signal.signalType === "METRIC"
      ? "METRIC"
      : signal.signalType === "LOG" || signal.signalType === "ERROR"
        ? "LOG"
        : "SPAN";
  return {
    signalType: signal.signalType as NormalizedSignalDraft["signalType"],
    kind,
    name: signal.metricName ?? signal.signalType,
    serviceName: signal.serviceName ?? "unknown",
    environment: signal.environment ?? "unknown",
    resourceIdentity: signal.resourceIdentity ?? "unknown",
    observedAt: signal.observedAt,
    severity: signal.severity as NormalizedSignalDraft["severity"],
    traceId: signal.traceId,
    spanId: signal.spanId,
    parentSpanId: signal.parentSpanId,
    metricName: signal.metricName,
    logFingerprint: signal.logFingerprint,
    normalizedStatus: signal.normalizedStatus,
    fingerprint: signal.fingerprint,
    attributes: asRecord(signal.attributesJson) as NormalizedSignalDraft["attributes"],
    resourceAttributes: asRecord(
      signal.resourceAttributesJson
    ) as NormalizedSignalDraft["resourceAttributes"],
    healthImpact: signal.healthImpact as NormalizedSignalDraft["healthImpact"],
    freshUntil: signal.freshUntil ?? new Date(signal.observedAt.getTime() + 15 * 60_000)
  };
};

export const processOtelBatch = async (batchId: string): Promise<{ processed: number; failed: number }> => {
  const batch = await prisma.otelIngestBatch.findUnique({
    where: { id: batchId },
    include: {
      Signals: {
        where: { processingState: { in: ["PENDING", "FAILED"] } },
        orderBy: { observedAt: "asc" },
        take: 200
      }
    }
  });
  if (!batch) return { processed: 0, failed: 0 };

  await prisma.otelIngestBatch.update({
    where: { id: batchId },
    data: {
      status: "PROCESSING",
      processingStartedAt: new Date(),
      updatedAt: new Date()
    }
  });

  let processed = 0;
  let failed = 0;

  for (const signal of batch.Signals) {
    try {
      const draft = draftFromSignal(signal);
      const serviceEntity = await resolveOtelServiceEntity({
        organizationId: batch.organizationId,
        projectId: batch.projectId,
        draft
      });
      await resolveOtelInstanceEntity({
        organizationId: batch.organizationId,
        projectId: batch.projectId,
        draft,
        parentServiceId: serviceEntity.id
      });

      let relationshipId: string | null = null;
      let targetEntityId: string | null = null;
      if (isOtelTopologyDiscoveryEnabled() && draft.signalType === "DEPENDENCY") {
        const target = await resolveOtelDependencyEntity({
          organizationId: batch.organizationId,
          projectId: batch.projectId,
          draft
        });
        if (target) {
          targetEntityId = target.id;
          const relationship = await recordOtelDependencyEvidence({
            organizationId: batch.organizationId,
            projectId: batch.projectId,
            sourceEntityId: serviceEntity.id,
            targetEntityId: target.id,
            draft,
            sourceLegacyServiceId: serviceEntity.legacyServiceId,
            targetLegacyServiceId: target.legacyServiceId
          });
          relationshipId = relationship?.relationshipId ?? null;
        }
      }

      await applyOtelPolicyAlert({
        organizationId: batch.organizationId,
        projectId: batch.projectId,
        batchId: batch.id,
        signalId: signal.id,
        draft,
        entityId: serviceEntity.id,
        relationshipId,
        serviceId: serviceEntity.legacyServiceId
      });

      if (serviceEntity.legacyServiceId && draft.healthImpact !== "UNKNOWN") {
        const status =
          draft.healthImpact === "CRITICAL"
            ? "DOWN"
            : draft.healthImpact === "DEGRADED"
              ? "DEGRADED"
              : "HEALTHY";
        await prisma.service.update({
          where: { id: serviceEntity.legacyServiceId },
          data: { status, updatedAt: new Date() }
        });
      }

      await prisma.normalizedOperationalSignal.update({
        where: { id: signal.id },
        data: {
          sourceEntityId: serviceEntity.id,
          targetEntityId,
          processingState: "PROCESSED",
          processingAttempts: { increment: 1 },
          processingError: null,
          processedAt: new Date(),
          updatedAt: new Date()
        }
      });
      processed += 1;
    } catch (error) {
      failed += 1;
      const attempts = signal.processingAttempts + 1;
      const deadLetter = attempts >= maxBatchRetries();
      await prisma.normalizedOperationalSignal.update({
        where: { id: signal.id },
        data: {
          processingState: deadLetter ? "DEAD_LETTER" : "FAILED",
          processingAttempts: attempts,
          processingError: error instanceof Error ? error.message.slice(0, 500) : "processing_failed",
          updatedAt: new Date()
        }
      });
    }
  }

  const remaining = await prisma.normalizedOperationalSignal.count({
    where: {
      batchId,
      processingState: { in: ["PENDING", "FAILED"] }
    }
  });
  const dead = await prisma.normalizedOperationalSignal.count({
    where: { batchId, processingState: "DEAD_LETTER" }
  });

  const retryCount = batch.retryCount + (failed > 0 ? 1 : 0);
  const status =
    remaining === 0
      ? dead > 0
        ? "DEAD_LETTER"
        : "COMPLETED"
      : retryCount >= batch.maxRetries
        ? "DEAD_LETTER"
        : "PENDING";

  await prisma.otelIngestBatch.update({
    where: { id: batchId },
    data: {
      status,
      retryCount,
      nextRetryAt: status === "PENDING" ? new Date(Date.now() + 30_000) : null,
      deadLetterReason:
        status === "DEAD_LETTER" ? `failed_signals=${dead || failed}` : null,
      processedAt: remaining === 0 ? new Date() : null,
      evidenceJson: {
        ...(asRecord(batch.evidenceJson) as Record<string, unknown>),
        lastProcessed: { processed, failed, at: new Date().toISOString() }
      } as Prisma.InputJsonValue,
      updatedAt: new Date()
    }
  });

  return { processed, failed };
};

export const processPendingOtelBatches = async (limit = 20): Promise<{
  batches: number;
  processed: number;
  failed: number;
}> => {
  const now = new Date();
  const batches = await prisma.otelIngestBatch.findMany({
    where: {
      OR: [
        { status: "PENDING", nextRetryAt: null },
        { status: "PENDING", nextRetryAt: { lte: now } },
        { status: "FAILED", nextRetryAt: { lte: now } }
      ]
    },
    orderBy: { receivedAt: "asc" },
    take: limit,
    select: { id: true }
  });

  let processed = 0;
  let failed = 0;
  for (const batch of batches) {
    const result = await processOtelBatch(batch.id);
    processed += result.processed;
    failed += result.failed;
  }
  return { batches: batches.length, processed, failed };
};
