import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
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

  const now = new Date();
  const freshUntil = new Date(now.getTime() + relationshipFreshMs());
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

  if (existing) {
    const preserveConfirmed =
      existing.approvalStatus === "APPROVED" && existing.provenance !== "OTEL_COLLECTOR"
        ? existing.approvalStatus
        : existing.approvalStatus;
    const nextCount = existing.observationCount + 1;
    const discoveryState =
      existing.discoveryState === "CONFIRMED" || existing.approvalStatus === "APPROVED"
        ? existing.discoveryState === "INACTIVE"
          ? "DISCOVERED"
          : existing.discoveryState
        : nextCount >= threshold
          ? "DISCOVERED"
          : "CANDIDATE";

    const updated = await prisma.operationalRelationship.update({
      where: { id: existing.id },
      data: {
        observationCount: nextCount,
        confidence: Math.min(1, (existing.confidence ?? 0) + 0.05),
        lastObservedAt: input.draft.observedAt,
        freshUntil,
        staleAt: null,
        inactiveAt: null,
        discoveryState,
        approvalStatus: preserveConfirmed,
        lifecycle: "ACTIVE",
        health: isError ? "CRITICAL" : existing.health === "CRITICAL" ? "DEGRADED" : "HEALTHY",
        ...(typeof duration === "number" ? { latencyP95Ms: duration } : {}),
        errorRate: isError
          ? Math.min(1, (existing.errorRate ?? 0) * 0.8 + 0.2)
          : Math.max(0, (existing.errorRate ?? 0) * 0.8),
        evidenceJson: {
          lastSignalType: input.draft.signalType,
          lastFingerprint: input.draft.fingerprint,
          attributes: input.draft.attributes
        } as Prisma.InputJsonValue,
        updatedAt: now
      }
    });

    await maybeDualWriteServiceDependency({
      projectId: input.projectId,
      fromServiceId: input.sourceLegacyServiceId ?? null,
      toServiceId: input.targetLegacyServiceId ?? null,
      isError,
      observedAt: input.draft.observedAt
    });

    return { relationshipId: updated.id, discoveryState: updated.discoveryState };
  }

  const created = await prisma.operationalRelationship.create({
    data: {
      id: randomUUID(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      sourceEntityId: input.sourceEntityId,
      targetEntityId: input.targetEntityId,
      relationshipType,
      provenance: "OTEL_COLLECTOR",
      approvalStatus: "PENDING",
      requiresApproval: true,
      observationCount: 1,
      confidence: 0.2,
      discoveredAt: input.draft.observedAt,
      lastObservedAt: input.draft.observedAt,
      discoveryState: 1 >= threshold ? "DISCOVERED" : "CANDIDATE",
      freshUntil,
      health: isError ? "CRITICAL" : "UNKNOWN",
      errorRate: isError ? 1 : 0,
      ...(typeof duration === "number" ? { latencyP95Ms: duration } : {}),
      evidenceJson: {
        lastSignalType: input.draft.signalType,
        lastFingerprint: input.draft.fingerprint,
        attributes: input.draft.attributes
      } as Prisma.InputJsonValue,
      updatedAt: now
    }
  });

  await maybeDualWriteServiceDependency({
    projectId: input.projectId,
    fromServiceId: input.sourceLegacyServiceId ?? null,
    toServiceId: input.targetLegacyServiceId ?? null,
    isError,
    observedAt: input.draft.observedAt
  });

  return { relationshipId: created.id, discoveryState: created.discoveryState };
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
