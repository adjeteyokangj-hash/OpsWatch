import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { canonicalGraph } from "../canonical-graph.service";
import {
  isOtelTopologyDiscoveryEnabled,
  otelDependencyEvidenceThreshold
} from "./otel-feature-flags";
import type { NormalizedSignalDraft } from "./otel-normalize";

const relationshipFreshMs = (): number =>
  Number(process.env.OPSWATCH_OTEL_RELATIONSHIP_FRESH_MS ?? 30 * 60_000);

export const recordOtelDependencyEvidence = async (input: {
  organizationId: string;
  projectId: string | null;
  sourceEntityId: string;
  targetEntityId: string;
  draft: NormalizedSignalDraft;
  sourceLegacyServiceId?: string | null;
  targetLegacyServiceId?: string | null;
}): Promise<{ relationshipId: string; discoveryState: string } | null> => {
  if (!isOtelTopologyDiscoveryEnabled()) return null;

  const freshUntil = new Date(
    input.draft.observedAt.getTime() + relationshipFreshMs()
  );
  const threshold = otelDependencyEvidenceThreshold();
  const relationshipType =
    typeof input.draft.attributes["db.system"] === "string"
      ? "CALLS_DATABASE"
      : typeof input.draft.attributes["messaging.system"] === "string"
        ? "PUBLISHES_TO"
        : "CALLS";

  const existing = await prisma.operationalRelationship.findUnique({
    where: {
      organizationId_sourceEntityId_targetEntityId_relationshipType: {
        organizationId: input.organizationId,
        sourceEntityId: input.sourceEntityId,
        targetEntityId: input.targetEntityId,
        relationshipType
      }
    }
  });

  const isError =
    input.draft.healthImpact === "CRITICAL" || input.draft.normalizedStatus === "ERROR";
  const duration =
    typeof input.draft.attributes["http.duration_ms"] === "number"
      ? input.draft.attributes["http.duration_ms"]
      : null;
  const nextCount = (existing?.observationCount ?? 0) + 1;
  const discoveryState =
    existing?.discoveryState === "CONFIRMED" ||
    existing?.approvalStatus === "APPROVED"
      ? existing.discoveryState === "INACTIVE"
        ? "DISCOVERED"
        : existing.discoveryState
      : nextCount >= threshold
        ? "DISCOVERED"
        : "CANDIDATE";
  const relationship = await canonicalGraph.upsertRelationship({
    organizationId: input.organizationId,
    projectId: input.projectId,
    environment: input.draft.environment,
    sourceEntityId: input.sourceEntityId,
    targetEntityId: input.targetEntityId,
    relationshipType,
    source: "OTEL",
    provenance: "OTEL_COLLECTOR",
    observedAt: input.draft.observedAt,
    freshUntil,
    health: isError
      ? "CRITICAL"
      : existing?.health === "CRITICAL"
        ? "DEGRADED"
        : existing
          ? "HEALTHY"
          : "UNKNOWN",
    confidence: Math.min(1, (existing?.confidence ?? 0.15) + 0.05),
    approvalStatus: existing?.approvalStatus ?? "PENDING",
    requiresApproval: existing?.requiresApproval ?? true,
    confirmationState:
      discoveryState === "DISCOVERED" ? "CONFIRMED" : "CANDIDATE",
    discoveryState,
    evidenceCount: nextCount,
    latencyP95Ms: typeof duration === "number" ? duration : undefined,
    errorRate: isError
      ? Math.min(1, (existing?.errorRate ?? 0) * 0.8 + 0.2)
      : Math.max(0, (existing?.errorRate ?? 0) * 0.8),
    evidence: {
      lastSignalType: input.draft.signalType,
      lastFingerprint: input.draft.fingerprint,
      attributes: input.draft.attributes
    },
    compatibilityRelationshipId: existing?.id
  });

  await maybeDualWriteServiceDependency({
    projectId: input.projectId,
    fromServiceId: input.sourceLegacyServiceId ?? null,
    toServiceId: input.targetLegacyServiceId ?? null,
    isError,
    observedAt: input.draft.observedAt
  });

  return {
    relationshipId: relationship.id,
    discoveryState: relationship.discoveryState
  };
};

const maybeDualWriteServiceDependency = async (input: {
  projectId: string | null;
  fromServiceId: string | null;
  toServiceId: string | null;
  isError: boolean;
  observedAt: Date;
}): Promise<void> => {
  if (!input.projectId || !input.fromServiceId || !input.toServiceId) return;
  if (input.fromServiceId === input.toServiceId) return;

  const existing = await prisma.serviceDependency.findUnique({
    where: {
      fromServiceId_toServiceId_dependencyType: {
        fromServiceId: input.fromServiceId,
        toServiceId: input.toServiceId,
        dependencyType: "RUNTIME"
      }
    }
  });

  if (existing) {
    if (!existing.isActive || existing.projectId !== input.projectId) return;
    await prisma.serviceDependency.update({
      where: { id: existing.id },
      data: {
        evidenceCount: { increment: 1 },
        evidenceStrength: Math.min(1, existing.evidenceStrength + 0.05),
        lastObservedAt: input.observedAt,
        source: existing.source === "MANUAL" ? "TELEMETRY" : existing.source,
        updatedAt: new Date()
      }
    });
    return;
  }

  await prisma.serviceDependency.create({
    data: {
      id: randomUUID(),
      projectId: input.projectId,
      fromServiceId: input.fromServiceId,
      toServiceId: input.toServiceId,
      dependencyType: "RUNTIME",
      criticality: input.isError ? "HIGH" : "MEDIUM",
      isActive: true,
      evidenceCount: 1,
      evidenceStrength: 0.2,
      lastObservedAt: input.observedAt,
      source: "OTEL",
      updatedAt: new Date()
    }
  });
};
