import { prisma } from "../../lib/prisma";
import { recordObservation, recordOperationsTimelineEvent } from "./observation.service";
import { OBSERVATION_SOURCE, TIMELINE_EVENT } from "./intelligence-constants";

/**
 * Strengthen existing dependency edges from telemetry.
 * Never invents new App→Module→… edges — only updates evidence on known relations.
 */
export const recordDependencyEvidence = async (input: {
  organizationId: string;
  projectId: string;
  fromServiceId: string;
  toServiceId: string;
  dependencyType?: string;
  strengthDelta?: number;
}): Promise<{ updated: boolean; evidenceCount: number; evidenceStrength: number }> => {
  const dependencyType = input.dependencyType ?? "RUNTIME";
  const existing = await prisma.serviceDependency.findUnique({
    where: {
      fromServiceId_toServiceId_dependencyType: {
        fromServiceId: input.fromServiceId,
        toServiceId: input.toServiceId,
        dependencyType
      }
    }
  });

  if (!existing || !existing.isActive || existing.projectId !== input.projectId) {
    return { updated: false, evidenceCount: 0, evidenceStrength: 0 };
  }

  const evidenceCount = existing.evidenceCount + 1;
  const delta = input.strengthDelta ?? 0.05;
  const evidenceStrength = Math.min(1, existing.evidenceStrength + delta);
  const now = new Date();

  await prisma.serviceDependency.update({
    where: { id: existing.id },
    data: {
      evidenceCount,
      evidenceStrength,
      lastObservedAt: now,
      source: existing.source === "MANUAL" ? "TELEMETRY" : existing.source,
      updatedAt: now
    }
  });

  await recordObservation({
    organizationId: input.organizationId,
    projectId: input.projectId,
    sourceType: OBSERVATION_SOURCE.DEPENDENCY,
    sourceId: existing.id,
    eventKey: "dependency.evidence",
    summary: `Dependency evidence strengthened (${evidenceCount} observations)`,
    payloadJson: {
      fromServiceId: input.fromServiceId,
      toServiceId: input.toServiceId,
      evidenceStrength
    }
  });

  if (existing.evidenceCount === 0) {
    await recordOperationsTimelineEvent({
      organizationId: input.organizationId,
      projectId: input.projectId,
      eventType: TIMELINE_EVENT.DEPENDENCY_DISCOVERED,
      summary: "Dependency confirmed by telemetry evidence",
      sourceType: "DEPENDENCY",
      sourceId: existing.id
    });
  }

  return { updated: true, evidenceCount, evidenceStrength };
};
