import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import type { NormalizedSignalDraft } from "../otel/otel-normalize";
import {
  APM_SPAN_FRESH_MS,
  DEFAULT_TELEMETRY_RETENTION_DAYS,
  isTraceApmProcessingEnabled
} from "./logs-apm-feature-flags";
import { redactLogPayload } from "./log-redaction";
import { reconstructTrace } from "./trace-reconstruct.service";

export type PersistSpanInput = {
  organizationId: string;
  projectId: string | null;
  connectionId: string;
  serviceEntityId: string | null;
  sourceEntityId?: string | null;
  destinationEntityId?: string | null;
  batchId: string;
  signalId: string;
  draft: NormalizedSignalDraft;
  retentionDays?: number;
};

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value.slice(0, 200) : null;

const asInt = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
};

const spanStatus = (draft: NormalizedSignalDraft): string => {
  if (draft.normalizedStatus) return draft.normalizedStatus;
  if (draft.healthImpact === "CRITICAL") return "ERROR";
  if (draft.healthImpact === "DEGRADED") return "ERROR";
  return "OK";
};

export const persistSpanRecord = async (
  input: PersistSpanInput
): Promise<{ spanId: string | null; traceRecordId: string | null; skipped: boolean }> => {
  if (!isTraceApmProcessingEnabled()) {
    return { spanId: null, traceRecordId: null, skipped: true };
  }
  if (input.draft.kind !== "SPAN" && input.draft.signalType !== "SPAN" && input.draft.signalType !== "DEPENDENCY" && input.draft.signalType !== "ERROR") {
    // Allow ERROR spans classified from failed spans
    if (!input.draft.traceId || !input.draft.spanId) {
      return { spanId: null, traceRecordId: null, skipped: true };
    }
  }
  if (!input.draft.traceId || !input.draft.spanId) {
    return { spanId: null, traceRecordId: null, skipped: true };
  }

  const redacted = redactLogPayload({
    attributes: input.draft.attributes,
    resourceAttributes: input.draft.resourceAttributes
  });
  const attrs = redacted.attributes;
  const durationMs =
    asInt(attrs["duration_ms"]) ??
    asInt(attrs["durationMs"]) ??
    (typeof input.draft.value === "number" ? Math.round(input.draft.value) : null);
  const startTimestamp = input.draft.observedAt;
  const endTimestamp =
    durationMs !== null ? new Date(startTimestamp.getTime() + durationMs) : startTimestamp;
  const retentionDays = input.retentionDays ?? DEFAULT_TELEMETRY_RETENTION_DAYS();
  const retentionExpiresAt = new Date(
    startTimestamp.getTime() + retentionDays * 24 * 60 * 60_000
  );
  const operationName =
    asString(attrs["http.route"]) ??
    asString(attrs["db.operation"]) ??
    asString(attrs["messaging.operation"]) ??
    input.draft.name ??
    "operation";
  const httpStatusCode = asInt(attrs["http.status_code"]);
  const status = spanStatus(input.draft);
  const exceptionSummary =
    asString(attrs["exception.message"]) ??
    asString(attrs["error.message"]) ??
    (status === "ERROR" ? input.draft.body?.slice(0, 240) ?? null : null);

  let trace = await prisma.traceRecord.findFirst({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      traceId: input.draft.traceId
    }
  });
  if (!trace) {
    const id = randomUUID();
    trace = await prisma.traceRecord.create({
      data: {
        id,
        organizationId: input.organizationId,
        projectId: input.projectId,
        environment: input.draft.environment,
        connectionId: input.connectionId,
        traceId: input.draft.traceId,
        rootServiceName: input.draft.serviceName,
        rootSpanId: input.draft.parentSpanId ? null : input.draft.spanId,
        startAt: startTimestamp,
        endAt: endTimestamp,
        durationMs,
        spanCount: 0,
        status: "UNSET",
        isPartial: true,
        retentionExpiresAt,
        evidenceBatchId: input.batchId,
        updatedAt: new Date()
      }
    });
  }

  const existing = await prisma.spanRecord.findUnique({
    where: {
      organizationId_traceId_spanId: {
        organizationId: input.organizationId,
        traceId: input.draft.traceId,
        spanId: input.draft.spanId
      }
    }
  });
  if (existing) {
    await reconstructTrace({
      organizationId: input.organizationId,
      projectId: input.projectId,
      traceId: input.draft.traceId,
      lateArrival: true
    });
    return { spanId: existing.id, traceRecordId: trace.id, skipped: false };
  }

  const spanRowId = randomUUID();
  await prisma.spanRecord.create({
    data: {
      id: spanRowId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      environment: input.draft.environment,
      connectionId: input.connectionId,
      serviceEntityId: input.serviceEntityId,
      sourceEntityId: input.sourceEntityId ?? input.serviceEntityId,
      destinationEntityId: input.destinationEntityId ?? null,
      traceId: input.draft.traceId,
      spanId: input.draft.spanId,
      parentSpanId: input.draft.parentSpanId,
      spanKind: asString(attrs["span.kind"]) ?? (input.draft.signalType === "DEPENDENCY" ? "CLIENT" : "INTERNAL"),
      operationName,
      startTimestamp,
      endTimestamp,
      durationMs,
      status,
      exceptionSummary,
      httpMethod: asString(attrs["http.method"]),
      httpRoute: asString(attrs["http.route"]),
      httpStatusCode,
      dbSystem: asString(attrs["db.system"]),
      dbOperation: asString(attrs["db.operation"]),
      messagingSystem: asString(attrs["messaging.system"]),
      messagingDestination: asString(attrs["messaging.destination.name"]),
      externalPeer: asString(attrs["peer.service"]) ?? asString(attrs["server.address"]),
      attributesJson: attrs as Prisma.InputJsonValue,
      redactionStatus: redacted.redactionStatus,
      retentionExpiresAt,
      evidenceSignalId: input.signalId,
      evidenceBatchId: input.batchId,
      traceRecordId: trace.id,
      updatedAt: new Date()
    }
  });

  await reconstructTrace({
    organizationId: input.organizationId,
    projectId: input.projectId,
    traceId: input.draft.traceId,
    lateArrival: false
  });

  // Touch freshness is based on span evidence, never project heartbeat.
  void APM_SPAN_FRESH_MS;

  return { spanId: spanRowId, traceRecordId: trace.id, skipped: false };
};
