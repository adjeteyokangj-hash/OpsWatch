import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import type { NormalizedSignalDraft } from "../otel/otel-normalize";
import {
  DEFAULT_TELEMETRY_RETENTION_DAYS,
  isLogsIngestionEnabled,
  LOG_GROUPING_WINDOW_MS
} from "./logs-apm-feature-flags";
import {
  buildLogFingerprint,
  extractExceptionClass,
  extractOperation,
  normalizeLogMessage
} from "./log-fingerprint";
import { redactLogPayload } from "./log-redaction";

export type PersistLogInput = {
  organizationId: string;
  projectId: string | null;
  connectionId: string;
  entityId: string | null;
  batchId?: string | null;
  signalId: string;
  draft: NormalizedSignalDraft;
  retentionDays?: number;
};

const severityNumber = (severity: string | undefined): number | null => {
  switch ((severity ?? "").toUpperCase()) {
    case "INFO":
    case "LOW":
      return 9;
    case "MEDIUM":
      return 13;
    case "HIGH":
      return 17;
    case "CRITICAL":
      return 21;
    default:
      return null;
  }
};

export const upsertLogOccurrenceGroup = async (input: {
  organizationId: string;
  projectId: string | null;
  environment: string;
  entityId: string | null;
  fingerprint: string;
  severity: string | null;
  normalizedMessage: string;
  exceptionClass: string | null;
  operation: string | null;
  observedAt: Date;
  sampleEvidence: Record<string, unknown>;
  retentionExpiresAt: Date;
}): Promise<{ id: string; occurrenceCount: number; status: string }> => {
  const windowMs = LOG_GROUPING_WINDOW_MS();
  const existing = await prisma.logOccurrenceGroup.findFirst({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      environment: input.environment,
      fingerprint: input.fingerprint
    }
  });

  if (!existing) {
    const id = randomUUID();
    await prisma.logOccurrenceGroup.create({
      data: {
        id,
        organizationId: input.organizationId,
        projectId: input.projectId,
        environment: input.environment,
        entityId: input.entityId,
        fingerprint: input.fingerprint,
        severity: input.severity,
        normalizedMessage: input.normalizedMessage,
        exceptionClass: input.exceptionClass,
        operation: input.operation,
        occurrenceCount: 1,
        firstSeenAt: input.observedAt,
        lastSeenAt: input.observedAt,
        sampleEvidenceJson: input.sampleEvidence as Prisma.InputJsonValue,
        groupingWindowMs: windowMs,
        status: "ACTIVE",
        retentionExpiresAt: input.retentionExpiresAt,
        updatedAt: input.observedAt
      }
    });
    return { id, occurrenceCount: 1, status: "ACTIVE" };
  }

  const inactive =
    input.observedAt.getTime() - existing.lastSeenAt.getTime() > existing.groupingWindowMs;
  let status = existing.status;
  if (existing.status === "RECOVERED" || inactive) {
    status = "REOPENED";
  } else if (existing.suppressedUntil && existing.suppressedUntil > input.observedAt) {
    status = "SUPPRESSED";
  } else {
    status = "ACTIVE";
  }

  const updated = await prisma.logOccurrenceGroup.update({
    where: { id: existing.id },
    data: {
      occurrenceCount: { increment: 1 },
      lastSeenAt: input.observedAt,
      status,
      severity: input.severity ?? existing.severity,
      sampleEvidenceJson: input.sampleEvidence as Prisma.InputJsonValue,
      retentionExpiresAt: input.retentionExpiresAt,
      updatedAt: new Date()
    }
  });
  return { id: updated.id, occurrenceCount: updated.occurrenceCount, status: updated.status };
};

export const persistLogRecord = async (
  input: PersistLogInput
): Promise<{ logId: string | null; groupId: string | null; skipped: boolean }> => {
  if (!isLogsIngestionEnabled()) {
    return { logId: null, groupId: null, skipped: true };
  }
  if (input.draft.kind !== "LOG" && input.draft.signalType !== "LOG" && input.draft.signalType !== "ERROR") {
    return { logId: null, groupId: null, skipped: true };
  }

  const redacted = redactLogPayload({
    body: input.draft.body,
    attributes: input.draft.attributes,
    resourceAttributes: input.draft.resourceAttributes
  });
  const normalizedMessage = normalizeLogMessage(redacted.body ?? input.draft.name);
  const exceptionClass = extractExceptionClass(redacted.body, redacted.attributes);
  const operation = extractOperation(redacted.attributes);
  const fingerprint = buildLogFingerprint({
    projectId: input.projectId,
    environment: input.draft.environment,
    entityId: input.entityId,
    severity: input.draft.severity ?? null,
    normalizedMessage,
    exceptionClass,
    operation
  });
  const retentionDays = input.retentionDays ?? DEFAULT_TELEMETRY_RETENTION_DAYS();
  const retentionExpiresAt = new Date(
    input.draft.observedAt.getTime() + retentionDays * 24 * 60 * 60_000
  );
  const serviceNamespace =
    typeof redacted.resourceAttributes["service.namespace"] === "string"
      ? String(redacted.resourceAttributes["service.namespace"])
      : null;
  const serviceInstance =
    typeof redacted.resourceAttributes["service.instance.id"] === "string"
      ? String(redacted.resourceAttributes["service.instance.id"]).slice(0, 120)
      : typeof redacted.resourceAttributes["host.name"] === "string"
        ? String(redacted.resourceAttributes["host.name"]).slice(0, 120)
        : null;
  const correlationId =
    typeof redacted.attributes["correlation.id"] === "string"
      ? String(redacted.attributes["correlation.id"])
      : null;

  const group = await upsertLogOccurrenceGroup({
    organizationId: input.organizationId,
    projectId: input.projectId,
    environment: input.draft.environment,
    entityId: input.entityId,
    fingerprint,
    severity: input.draft.severity ?? null,
    normalizedMessage,
    exceptionClass,
    operation,
    observedAt: input.draft.observedAt,
    sampleEvidence: {
      bodyPreview: (redacted.body ?? "").slice(0, 200),
      traceId: input.draft.traceId,
      spanId: input.draft.spanId,
      signalId: input.signalId
    },
    retentionExpiresAt
  });

  const logId = randomUUID();
  await prisma.logRecord.create({
    data: {
      id: logId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      environment: input.draft.environment,
      connectionId: input.connectionId,
      entityId: input.entityId,
      serviceName: input.draft.serviceName,
      serviceNamespace,
      serviceInstance,
      provider: "OTEL",
      source: "OTEL_COLLECTOR",
      timestamp: input.draft.observedAt,
      receivedAt: new Date(),
      severity: input.draft.severity ?? null,
      severityNumber: severityNumber(input.draft.severity),
      body: redacted.body ?? null,
      attributesJson: redacted.attributes as Prisma.InputJsonValue,
      resourceAttributesJson: redacted.resourceAttributes as Prisma.InputJsonValue,
      traceId: input.draft.traceId,
      spanId: input.draft.spanId,
      correlationId,
      fingerprint,
      occurrenceGroupId: group.id,
      redactionStatus: redacted.redactionStatus,
      redactionMetaJson: redacted.redactionMeta as Prisma.InputJsonValue,
      retentionExpiresAt,
      evidenceSignalId: input.signalId,
      evidenceBatchId: input.batchId ?? null,
      sourceRef: `signal:${input.signalId}`
    }
  });

  await prisma.logOccurrenceGroup.update({
    where: { id: group.id },
    data: { sampleLogId: logId, updatedAt: new Date() }
  });

  return { logId, groupId: group.id, skipped: false };
};
