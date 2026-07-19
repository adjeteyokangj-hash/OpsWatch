import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createAlert } from "../alerting.service";
import { isOtelAlertGenerationEnabled } from "../otel/otel-feature-flags";
import { apmFingerprint } from "./apm-aggregate.service";

const FATAL_OCCURRENCE_THRESHOLD = 3;

export const maybeAlertFromLogGroup = async (input: {
  organizationId: string;
  projectId: string | null;
  groupId: string;
  entityId: string | null;
  logId: string | null;
  severity: string | null;
  fingerprint: string;
  occurrenceCount: number;
  message: string;
  observedAt: Date;
  traceId?: string | null;
}): Promise<string | null> => {
  if (!isOtelAlertGenerationEnabled() || !input.projectId) return null;
  const severity = (input.severity ?? "").toUpperCase();
  const isFatal = severity === "CRITICAL" || severity === "HIGH";
  if (!isFatal || input.occurrenceCount < FATAL_OCCURRENCE_THRESHOLD) return null;

  const sourceId = `log-group:${input.fingerprint}`;
  const result = await createAlert({
    projectId: input.projectId,
    sourceType: "OTEL_POLICY",
    sourceId,
    severity: severity === "CRITICAL" ? "CRITICAL" : "HIGH",
    category: "AVAILABILITY",
    title: "Repeated fatal log group",
    message: input.message.slice(0, 500),
    dedupeBySourceId: true
  });
  if (!result.alertId) return null;

  await prisma.alert.update({
    where: { id: result.alertId },
    data: { operationalEntityId: input.entityId ?? undefined, fingerprint: input.fingerprint }
  });
  await prisma.logEvidenceLink.create({
    data: {
      id: randomUUID(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      alertId: result.alertId,
      logRecordId: input.logId,
      occurrenceGroupId: input.groupId,
      evidenceKind: "repeated_fatal_logs",
      summary: input.message.slice(0, 400),
      confidence: 0.85,
      metadataJson: {
        fingerprint: input.fingerprint,
        occurrenceCount: input.occurrenceCount,
        traceId: input.traceId ?? null
      } as Prisma.InputJsonValue,
      observedAt: input.observedAt
    }
  });
  await prisma.logOccurrenceGroup.update({
    where: { id: input.groupId },
    data: { relatedAlertId: result.alertId, updatedAt: new Date() }
  });
  return result.alertId;
};

export const maybeAlertFromApmWindow = async (input: {
  organizationId: string;
  projectId: string | null;
  entityId: string | null;
  relationshipId?: string | null;
  serviceName: string;
  environment: string;
  health: string;
  healthRule: string | null;
  errorRate: number;
  latencyP95Ms: number | null;
  sampleCount: number;
  windowId: string;
  windowKind: "service" | "endpoint" | "dependency";
  observedAt: Date;
  message: string;
}): Promise<string | null> => {
  if (!isOtelAlertGenerationEnabled() || !input.projectId) return null;
  if (input.health !== "DEGRADED" && input.health !== "CRITICAL") return null;
  if (input.sampleCount < 3) return null;

  const fp = apmFingerprint([
    input.projectId,
    input.environment,
    input.serviceName,
    input.healthRule ?? input.health,
    input.windowKind
  ]);
  const sourceId = `apm:${fp}`;
  const result = await createAlert({
    projectId: input.projectId,
    sourceType: "OTEL_POLICY",
    sourceId,
    severity: input.health === "CRITICAL" ? "CRITICAL" : "HIGH",
    category: "PERFORMANCE",
    title:
      input.windowKind === "dependency"
        ? "Dependency performance degradation"
        : "APM threshold exceeded",
    message: input.message.slice(0, 500),
    dedupeBySourceId: true
  });
  if (!result.alertId) return null;

  await prisma.alert.update({
    where: { id: result.alertId },
    data: {
      operationalEntityId: input.entityId ?? undefined,
      operationalRelationshipId: input.relationshipId ?? undefined,
      fingerprint: fp
    }
  });
  await prisma.apmEvidenceLink.create({
    data: {
      id: randomUUID(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      alertId: result.alertId,
      serviceWindowId: input.windowKind === "service" ? input.windowId : null,
      endpointWindowId: input.windowKind === "endpoint" ? input.windowId : null,
      dependencyWindowId: input.windowKind === "dependency" ? input.windowId : null,
      evidenceKind: input.healthRule ?? "apm_degradation",
      summary: input.message.slice(0, 400),
      confidence: 0.8,
      metadataJson: {
        errorRate: input.errorRate,
        latencyP95Ms: input.latencyP95Ms,
        sampleCount: input.sampleCount,
        health: input.health
      } as Prisma.InputJsonValue,
      observedAt: input.observedAt
    }
  });
  return result.alertId;
};
