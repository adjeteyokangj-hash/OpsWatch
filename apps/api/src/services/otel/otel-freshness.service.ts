import { prisma } from "../../lib/prisma";
import { applyOtelPolicyAlert } from "./otel-alert.service";
import { isOtelAlertGenerationEnabled } from "./otel-feature-flags";
import type { NormalizedSignalDraft } from "./otel-normalize";

/**
 * OTEL freshness is independent of heartbeat timestamps.
 * Heartbeat jobs must never write OperationalEntity/Relationship OTEL freshness fields.
 */
export const processOtelFreshness = async (): Promise<{
  staleEntities: number;
  inactiveEntities: number;
  staleRelationships: number;
  inactiveRelationships: number;
  staleAlerts: number;
}> => {
  const now = new Date();
  const inactiveAfterMs = Number(process.env.OPSWATCH_OTEL_INACTIVE_AFTER_MS ?? 2 * 60 * 60_000);

  const staleEntities = await prisma.operationalEntity.updateMany({
    where: {
      discoverySource: "OTEL_BRIDGE",
      discoveryState: "ACTIVE",
      freshUntil: { lt: now },
      OR: [{ staleAt: null }, { staleAt: { gt: now } }]
    },
    data: {
      discoveryState: "STALE",
      health: "UNKNOWN",
      healthReason: "otel_stale",
      staleAt: now,
      updatedAt: now
    }
  });

  const inactiveCutoff = new Date(now.getTime() - inactiveAfterMs);
  const inactiveEntities = await prisma.operationalEntity.updateMany({
    where: {
      discoverySource: "OTEL_BRIDGE",
      discoveryState: "STALE",
      lastSeenAt: { lt: inactiveCutoff }
    },
    data: {
      discoveryState: "INACTIVE",
      lifecycle: "INACTIVE",
      inactiveAt: now,
      updatedAt: now
    }
  });

  const staleRelationships = await prisma.operationalRelationship.updateMany({
    where: {
      provenance: "OTEL_COLLECTOR",
      discoveryState: { in: ["CANDIDATE", "DISCOVERED", "ACTIVE"] },
      freshUntil: { lt: now }
    },
    data: {
      discoveryState: "STALE",
      health: "UNKNOWN",
      staleAt: now,
      updatedAt: now
    }
  });

  const inactiveRelationships = await prisma.operationalRelationship.updateMany({
    where: {
      provenance: "OTEL_COLLECTOR",
      discoveryState: "STALE",
      lastObservedAt: { lt: inactiveCutoff }
    },
    data: {
      discoveryState: "INACTIVE",
      lifecycle: "INACTIVE",
      inactiveAt: now,
      updatedAt: now
    }
  });

  await prisma.normalizedOperationalSignal.updateMany({
    where: {
      processingState: "PROCESSED",
      freshUntil: { lt: now },
      healthImpact: { not: "UNKNOWN" }
    },
    data: {
      healthImpact: "UNKNOWN",
      updatedAt: now
    }
  });

  let staleAlerts = 0;
  if (isOtelAlertGenerationEnabled()) {
    const staleServices = await prisma.operationalEntity.findMany({
      where: {
        discoverySource: "OTEL_BRIDGE",
        discoveryState: "STALE",
        entityType: "SERVICE",
        projectId: { not: null }
      },
      take: 50,
      select: {
        id: true,
        organizationId: true,
        projectId: true,
        name: true,
        legacyServiceId: true,
        lastSeenAt: true
      }
    });

    for (const entity of staleServices) {
      if (!entity.projectId) continue;
      const draft: NormalizedSignalDraft = {
        signalType: "SERVICE_HEALTH",
        kind: "METRIC",
        name: "otel.freshness",
        serviceName: entity.name,
        environment: "unknown",
        resourceIdentity: entity.id,
        observedAt: entity.lastSeenAt ?? now,
        fingerprint: `stale:${entity.id}`,
        attributes: {},
        resourceAttributes: {},
        healthImpact: "UNKNOWN",
        freshUntil: now
      };
      const result = await applyOtelPolicyAlert({
        organizationId: entity.organizationId,
        projectId: entity.projectId,
        draft,
        entityId: entity.id,
        serviceId: entity.legacyServiceId,
        isStale: true
      });
      if (result.alertId) staleAlerts += 1;
    }
  }

  return {
    staleEntities: staleEntities.count,
    inactiveEntities: inactiveEntities.count,
    staleRelationships: staleRelationships.count,
    inactiveRelationships: inactiveRelationships.count,
    staleAlerts
  };
};
