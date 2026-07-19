import { createHash, randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { dispatchAlertNotifications } from "../notifications/notification.service";

/**
 * OTEL freshness transitions. Heartbeat jobs must not write these fields.
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
      freshUntil: { lt: now }
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
    where: { freshUntil: { lt: now }, healthImpact: { not: "UNKNOWN" } },
    data: { healthImpact: "UNKNOWN", updatedAt: now }
  });

  let staleAlerts = 0;
  if (process.env.OPSWATCH_OTEL_ALERT_GENERATION_ENABLED === "true") {
    const staleServices = await prisma.operationalEntity.findMany({
      where: {
        discoverySource: "OTEL_BRIDGE",
        discoveryState: "STALE",
        entityType: "SERVICE",
        projectId: { not: null }
      },
      take: 50
    });
    for (const entity of staleServices) {
      if (!entity.projectId) continue;
      const sourceId = `otel:stale:${createHash("sha256").update(entity.id).digest("hex").slice(0, 40)}`;
      const existing = await prisma.alert.findFirst({
        where: {
          projectId: entity.projectId,
          sourceType: "OTEL_POLICY",
          sourceId,
          status: { in: ["OPEN", "ACKNOWLEDGED"] }
        }
      });
      if (existing) {
        await prisma.alert.update({
          where: { id: existing.id },
          data: { lastSeenAt: now, occurrenceCount: { increment: 1 } }
        });
        staleAlerts += 1;
        continue;
      }
      const alertId = randomUUID();
      await prisma.alert.create({
        data: {
          id: alertId,
          projectId: entity.projectId,
          serviceId: entity.legacyServiceId,
          sourceType: "OTEL_POLICY",
          sourceId,
          severity: "MEDIUM",
          category: "AVAILABILITY",
          title: `OTEL stale: ${entity.name}`,
          message: `No fresh OTEL signals for ${entity.name}`,
          fingerprint: sourceId
        }
      });
      await prisma.otelAlertEvidence.create({
        data: {
          id: randomUUID(),
          organizationId: entity.organizationId,
          projectId: entity.projectId,
          alertId,
          entityId: entity.id,
          evidenceKind: "otel.freshness.stale",
          summary: `Stale OTEL entity ${entity.name}`,
          confidence: 0.4,
          observedAt: now
        }
      });
      await dispatchAlertNotifications(alertId, "triggered");
      staleAlerts += 1;
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
