import { prisma } from "../../lib/prisma";
import { getOtelFeatureFlags } from "./otel-feature-flags";

export type ProjectOtelStatus = {
  connections: number;
  connectionHealth: string | null;
  lastSignalAt: string | null;
  signalCounts: {
    metric: number;
    log: number;
    trace: number;
    span: number;
    error: number;
    dependency: number;
    total: number;
  };
  discoveredEntities: number;
  discoveredRelationships: number;
  staleEntities: number;
  features: {
    ingestion: boolean;
    topologyDiscovery: boolean;
    alertGeneration: boolean;
    incidentCorrelation: boolean;
  };
  processingNotes: string[];
  label: string;
};

export const loadProjectOtelStatus = async (
  organizationId: string,
  projectId: string,
  otelConnections: Array<{ health?: string | null; installationStatus?: string | null }>
): Promise<ProjectOtelStatus> => {
  const features = getOtelFeatureFlags();
  const [signalGroups, lastSignal, entities, relationships, staleEntities] = await Promise.all([
    prisma.normalizedOperationalSignal.groupBy({
      by: ["signalType"],
      where: { organizationId, projectId },
      _count: { _all: true }
    }),
    prisma.normalizedOperationalSignal.findFirst({
      where: { organizationId, projectId },
      orderBy: { lastSeenAt: "desc" },
      select: { lastSeenAt: true }
    }),
    prisma.operationalEntity.count({
      where: { organizationId, projectId, discoverySource: "OTEL_BRIDGE" }
    }),
    prisma.operationalRelationship.count({
      where: { organizationId, projectId, provenance: "OTEL_COLLECTOR" }
    }),
    prisma.operationalEntity.count({
      where: {
        organizationId,
        projectId,
        discoverySource: "OTEL_BRIDGE",
        discoveryState: "STALE"
      }
    })
  ]);

  const counts = {
    metric: 0,
    log: 0,
    trace: 0,
    span: 0,
    error: 0,
    dependency: 0,
    total: 0
  };
  for (const row of signalGroups) {
    const n = row._count._all;
    counts.total += n;
    const key = row.signalType.toLowerCase();
    if (key === "metric") counts.metric += n;
    else if (key === "log") counts.log += n;
    else if (key === "trace") counts.trace += n;
    else if (key === "span") counts.span += n;
    else if (key === "error") counts.error += n;
    else if (key === "dependency") counts.dependency += n;
  }

  const processingNotes: string[] = [];
  if (!features.ingestion) {
    processingNotes.push("OTEL ingestion is disabled; collector payloads are not accepted.");
  }
  if (features.ingestion && !features.alertGeneration) {
    processingNotes.push(
      "Alert generation is disabled; normalised signals are stored without creating OTEL alerts."
    );
  }
  if (features.alertGeneration && !features.incidentCorrelation) {
    processingNotes.push(
      "Incident correlation for OTEL is disabled; OTEL alerts are not correlated into OTEL incident evidence."
    );
  }
  if (features.ingestion && !features.topologyDiscovery) {
    processingNotes.push(
      "Topology discovery is disabled; dependency candidates are not promoted from OTEL spans."
    );
  }

  const healthy = otelConnections.some(
    (connection) =>
      connection.health === "HEALTHY" || connection.installationStatus === "ACTIVE"
  );

  return {
    connections: otelConnections.length,
    connectionHealth: otelConnections.length === 0 ? null : healthy ? "HEALTHY" : "DEGRADED",
    lastSignalAt: lastSignal?.lastSeenAt.toISOString() ?? null,
    signalCounts: counts,
    discoveredEntities: entities,
    discoveredRelationships: relationships,
    staleEntities,
    features,
    processingNotes,
    label: "Foundation/Preview"
  };
};
