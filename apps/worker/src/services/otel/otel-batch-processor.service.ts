import { createHash, randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { dispatchAlertNotifications } from "../notifications/notification.service";

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const alertsEnabled = (): boolean =>
  process.env.OPSWATCH_OTEL_ALERT_GENERATION_ENABLED === "true";
const topologyEnabled = (): boolean =>
  process.env.OPSWATCH_OTEL_TOPOLOGY_DISCOVERY_ENABLED === "true";

const policyFingerprint = (parts: string[]): string =>
  createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);

const upsertOtelAlert = async (input: {
  projectId: string;
  serviceId?: string | null;
  sourceId: string;
  severity: "MEDIUM" | "HIGH" | "CRITICAL";
  category: "AVAILABILITY" | "PERFORMANCE" | "SECURITY" | "DEPENDENCY_CHANGE";
  title: string;
  message: string;
  organizationId: string;
  batchId: string;
  signalId: string;
  entityId?: string | null;
  traceId?: string | null;
  spanId?: string | null;
  evidenceKind: string;
}): Promise<string | null> => {
  if (!alertsEnabled()) return null;
  const existing = await prisma.alert.findFirst({
    where: {
      projectId: input.projectId,
      sourceType: "OTEL_POLICY",
      sourceId: input.sourceId,
      status: { in: ["OPEN", "ACKNOWLEDGED", "REMEDIATING", "VERIFYING"] }
    }
  });
  let alertId: string;
  if (existing) {
    await prisma.alert.update({
      where: { id: existing.id },
      data: {
        severity: input.severity,
        category: input.category,
        message: input.message,
        lastSeenAt: new Date(),
        occurrenceCount: { increment: 1 }
      }
    });
    alertId = existing.id;
  } else {
    alertId = randomUUID();
    await prisma.alert.create({
      data: {
        id: alertId,
        projectId: input.projectId,
        serviceId: input.serviceId ?? undefined,
        sourceType: "OTEL_POLICY",
        sourceId: input.sourceId,
        severity: input.severity,
        category: input.category,
        title: input.title,
        message: input.message,
        fingerprint: input.sourceId
      }
    });
    await dispatchAlertNotifications(alertId, "triggered");
  }

  await prisma.otelAlertEvidence.create({
    data: {
      id: randomUUID(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      alertId,
      batchId: input.batchId,
      signalId: input.signalId,
      entityId: input.entityId ?? null,
      traceId: input.traceId ?? null,
      spanId: input.spanId ?? null,
      evidenceKind: input.evidenceKind,
      summary: input.message,
      confidence: 0.8,
      observedAt: new Date()
    }
  });
  return alertId;
};

export const processOtelBatch = async (
  batchId: string
): Promise<{ processed: number; failed: number }> => {
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
    data: { status: "PROCESSING", processingStartedAt: new Date(), updatedAt: new Date() }
  });

  let processed = 0;
  let failed = 0;

  for (const signal of batch.Signals) {
    try {
      const attrs = asRecord(signal.attributesJson);
      const serviceName = signal.serviceName ?? "unknown";
      const environment = signal.environment ?? "unknown";

      let entity = signal.sourceEntityId
        ? await prisma.operationalEntity.findUnique({ where: { id: signal.sourceEntityId } })
        : null;
      if (!entity) {
        const externalId = `otel:${serviceName}:${environment}`;
        entity = await prisma.operationalEntity.upsert({
          where: {
            organizationId_entityType_externalId: {
              organizationId: batch.organizationId,
              entityType: "SERVICE",
              externalId
            }
          },
          create: {
            id: randomUUID(),
            organizationId: batch.organizationId,
            projectId: batch.projectId,
            entityType: "SERVICE",
            name: serviceName,
            externalId,
            provenance: "OTEL_COLLECTOR",
            discoverySource: "OTEL_BRIDGE",
            discoveredAt: signal.observedAt,
            firstSeenAt: signal.observedAt,
            lastSeenAt: signal.observedAt,
            freshUntil: signal.freshUntil,
            signalCount: 1,
            lastSignalKind: signal.signalType,
            discoveryState: "ACTIVE",
            updatedAt: new Date()
          },
          update: {
            lastSeenAt: signal.observedAt,
            freshUntil: signal.freshUntil,
            staleAt: null,
            inactiveAt: null,
            signalCount: { increment: 1 },
            lastSignalKind: signal.signalType,
            discoveryState: "ACTIVE",
            updatedAt: new Date()
          }
        });
      }

      let targetEntityId: string | null = null;
      if (topologyEnabled() && signal.signalType === "DEPENDENCY") {
        const peer =
          (typeof attrs["peer.service"] === "string" && attrs["peer.service"]) ||
          (typeof attrs["server.address"] === "string" && attrs["server.address"]) ||
          null;
        if (peer) {
          const targetExternalId = `otel-dep:EXTERNAL_API:${environment}:${peer}`;
          const target = await prisma.operationalEntity.upsert({
            where: {
              organizationId_entityType_externalId: {
                organizationId: batch.organizationId,
                entityType: "EXTERNAL_API",
                externalId: targetExternalId
              }
            },
            create: {
              id: randomUUID(),
              organizationId: batch.organizationId,
              projectId: batch.projectId,
              entityType: "EXTERNAL_API",
              name: peer,
              externalId: targetExternalId,
              provenance: "OTEL_COLLECTOR",
              discoverySource: "OTEL_BRIDGE",
              discoveredAt: signal.observedAt,
              firstSeenAt: signal.observedAt,
              lastSeenAt: signal.observedAt,
              freshUntil: signal.freshUntil,
              signalCount: 1,
              discoveryState: "ACTIVE",
              updatedAt: new Date()
            },
            update: {
              lastSeenAt: signal.observedAt,
              freshUntil: signal.freshUntil,
              signalCount: { increment: 1 },
              discoveryState: "ACTIVE",
              updatedAt: new Date()
            }
          });
          targetEntityId = target.id;
          const threshold = Number(process.env.OPSWATCH_OTEL_DEPENDENCY_EVIDENCE_THRESHOLD ?? 3);
          const existingRel = await prisma.operationalRelationship.findUnique({
            where: {
              organizationId_sourceEntityId_targetEntityId_relationshipType: {
                organizationId: batch.organizationId,
                sourceEntityId: entity.id,
                targetEntityId: target.id,
                relationshipType: "CALLS"
              }
            }
          });
          if (existingRel) {
            const nextCount = existingRel.observationCount + 1;
            await prisma.operationalRelationship.update({
              where: { id: existingRel.id },
              data: {
                observationCount: nextCount,
                discoveryState: nextCount >= threshold ? "DISCOVERED" : "CANDIDATE",
                lastObservedAt: signal.observedAt,
                freshUntil: signal.freshUntil,
                health: signal.healthImpact === "CRITICAL" ? "CRITICAL" : "HEALTHY",
                updatedAt: new Date()
              }
            });
          } else {
            await prisma.operationalRelationship.create({
              data: {
                id: randomUUID(),
                organizationId: batch.organizationId,
                projectId: batch.projectId,
                sourceEntityId: entity.id,
                targetEntityId: target.id,
                relationshipType: "CALLS",
                provenance: "OTEL_COLLECTOR",
                approvalStatus: "PENDING",
                requiresApproval: true,
                observationCount: 1,
                discoveryState: 1 >= threshold ? "DISCOVERED" : "CANDIDATE",
                discoveredAt: signal.observedAt,
                lastObservedAt: signal.observedAt,
                freshUntil: signal.freshUntil,
                health: signal.healthImpact === "CRITICAL" ? "CRITICAL" : "UNKNOWN",
                updatedAt: new Date()
              }
            });
          }

          if (entity.legacyServiceId && target.legacyServiceId && batch.projectId) {
            const dep = await prisma.serviceDependency.findUnique({
              where: {
                fromServiceId_toServiceId_dependencyType: {
                  fromServiceId: entity.legacyServiceId,
                  toServiceId: target.legacyServiceId,
                  dependencyType: "RUNTIME"
                }
              }
            });
            if (dep) {
              await prisma.serviceDependency.update({
                where: { id: dep.id },
                data: {
                  evidenceCount: { increment: 1 },
                  evidenceStrength: Math.min(1, dep.evidenceStrength + 0.05),
                  lastObservedAt: signal.observedAt,
                  source: dep.source === "MANUAL" ? "TELEMETRY" : dep.source,
                  updatedAt: new Date()
                }
              });
            } else {
              await prisma.serviceDependency.create({
                data: {
                  id: randomUUID(),
                  projectId: batch.projectId,
                  fromServiceId: entity.legacyServiceId,
                  toServiceId: target.legacyServiceId,
                  dependencyType: "RUNTIME",
                  source: "OTEL",
                  evidenceCount: 1,
                  evidenceStrength: 0.2,
                  lastObservedAt: signal.observedAt,
                  updatedAt: new Date()
                }
              });
            }
          }
        }
      }

      if (batch.projectId && (signal.healthImpact === "CRITICAL" || signal.healthImpact === "DEGRADED")) {
        const severity = signal.healthImpact === "CRITICAL" ? "CRITICAL" : "HIGH";
        const fp = policyFingerprint([
          "otel",
          serviceName,
          environment,
          signal.signalType,
          signal.fingerprint
        ]);
        await upsertOtelAlert({
          projectId: batch.projectId,
          serviceId: entity.legacyServiceId,
          sourceId: `otel:policy:${fp}`,
          severity,
          category:
            signal.signalType === "DEPENDENCY" ? "DEPENDENCY_CHANGE" : "AVAILABILITY",
          title: `OTEL ${signal.signalType.toLowerCase()}: ${serviceName}`,
          message: `${signal.metricName ?? signal.signalType} health=${signal.healthImpact}`,
          organizationId: batch.organizationId,
          batchId: batch.id,
          signalId: signal.id,
          entityId: entity.id,
          traceId: signal.traceId,
          spanId: signal.spanId,
          evidenceKind: `otel.${signal.signalType.toLowerCase()}`
        });
      }

      if (entity.legacyServiceId && signal.healthImpact !== "UNKNOWN") {
        await prisma.service.update({
          where: { id: entity.legacyServiceId },
          data: {
            status:
              signal.healthImpact === "CRITICAL"
                ? "DOWN"
                : signal.healthImpact === "DEGRADED"
                  ? "DEGRADED"
                  : "HEALTHY",
            updatedAt: new Date()
          }
        });
      }

      await prisma.normalizedOperationalSignal.update({
        where: { id: signal.id },
        data: {
          sourceEntityId: entity.id,
          targetEntityId,
          processingState: "PROCESSED",
          processingAttempts: { increment: 1 },
          processedAt: new Date(),
          processingError: null,
          updatedAt: new Date()
        }
      });
      processed += 1;
    } catch (error) {
      failed += 1;
      const attempts = signal.processingAttempts + 1;
      await prisma.normalizedOperationalSignal.update({
        where: { id: signal.id },
        data: {
          processingState: attempts >= 5 ? "DEAD_LETTER" : "FAILED",
          processingAttempts: attempts,
          processingError: error instanceof Error ? error.message.slice(0, 500) : "failed",
          updatedAt: new Date()
        }
      });
    }
  }

  const remaining = await prisma.normalizedOperationalSignal.count({
    where: { batchId, processingState: { in: ["PENDING", "FAILED"] } }
  });
  await prisma.otelIngestBatch.update({
    where: { id: batchId },
    data: {
      status: remaining === 0 ? "COMPLETED" : "PENDING",
      retryCount: { increment: failed > 0 ? 1 : 0 },
      nextRetryAt: remaining === 0 ? null : new Date(Date.now() + 30_000),
      processedAt: remaining === 0 ? new Date() : null,
      updatedAt: new Date()
    }
  });

  return { processed, failed };
};

export const processPendingOtelBatches = async (limit = 20) => {
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
