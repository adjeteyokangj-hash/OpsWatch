import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { ProjectTopologyResponse } from "../types/dto";
import { loadRecentCheckResultsByCheckIds } from "./check-result-batch.service";
import { buildProjectTopologyResponse, type TopologyServiceRecord } from "./topology.service";
import { loadCanonicalProjectTopology } from "./canonical-topology-loader.service";

const unresolvedIncidentStatuses = ["OPEN", "INVESTIGATING", "MONITORING"] as const;
const openAlertStatuses = [
  "OPEN",
  "ACKNOWLEDGED",
  "REMEDIATING",
  "VERIFYING",
  "RECOVERING"
] as const;

/** Soft cache absorbs Topology auto-refresh (15s) inside the same serverless isolate. */
const TOPOLOGY_CACHE_TTL_MS = 8_000;

type TopologyCacheEntry = {
  expiresAt: number;
  value: ProjectTopologyResponse;
};

const topologyCache = new Map<string, TopologyCacheEntry>();

type LatestSloWindowRow = {
  sloDefinitionId: string;
  status: string;
  availabilityPct: number | null;
  errorRatePct: number | null;
  p95LatencyMs: number | null;
  burnRate: number | null;
};

export const clearTopologyLoaderCache = (): void => {
  topologyCache.clear();
};

const loadLatestSloWindowsByDefinitionIds = async (
  definitionIds: string[]
): Promise<Map<string, LatestSloWindowRow>> => {
  const byDefinition = new Map<string, LatestSloWindowRow>();
  if (definitionIds.length === 0) return byDefinition;

  const rows = await prisma.$queryRaw<LatestSloWindowRow[]>`
    SELECT DISTINCT ON ("sloDefinitionId")
      "sloDefinitionId",
      status,
      "availabilityPct",
      "errorRatePct",
      "p95LatencyMs",
      "burnRate"
    FROM "SLOWindow"
    WHERE "sloDefinitionId" IN (${Prisma.join(definitionIds)})
    ORDER BY "sloDefinitionId", "windowEnd" DESC
  `;

  for (const row of rows) {
    byDefinition.set(row.sloDefinitionId, row);
  }
  return byDefinition;
};

const attachCheckResults = (
  services: Array<{
    id: string;
    name: string;
    type: TopologyServiceRecord["type"];
    status: string;
    Check: Array<{ id: string; isActive: boolean }>;
  }>,
  resultsByCheckId: Awaited<ReturnType<typeof loadRecentCheckResultsByCheckIds>>
): TopologyServiceRecord[] =>
  services.map((service) => ({
    id: service.id,
    name: service.name,
    type: service.type,
    status: service.status,
    Check: service.Check.map((check) => ({
      isActive: check.isActive,
      CheckResult: (resultsByCheckId.get(check.id) ?? []).map((row) => ({
        status: row.status,
        checkedAt: row.checkedAt,
        responseTimeMs: row.responseTimeMs
      }))
    }))
  }));

export const loadProjectTopology = async (
  organizationId: string,
  projectId: string
): Promise<ProjectTopologyResponse | null> => {
  const canonicalReadEnabled =
    process.env.OPSWATCH_CANONICAL_TOPOLOGY_READ_ENABLED === "true";
  const cacheKey = `${organizationId}:${projectId}:${canonicalReadEnabled ? "canonical" : "legacy"}`;
  const cached = topologyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true, name: true, status: true }
  });
  if (!project) return null;
  if (canonicalReadEnabled) {
    try {
      const topology = await loadCanonicalProjectTopology({
        organizationId,
        project
      });
      topologyCache.set(cacheKey, {
        expiresAt: Date.now() + TOPOLOGY_CACHE_TTL_MS,
        value: topology
      });
      return topology;
    } catch (error) {
      // Explicit, non-silent fallback: surface the failure in logs and diagnostic
      // rather than degrading to legacy without a trace.
      console.error(
        `[topology] canonical read failed for project ${projectId}; falling back to legacy`,
        error
      );
      const fallback = await buildLegacyProjectTopology(
        organizationId,
        projectId,
        project
      );
      if (process.env.NODE_ENV !== "production") {
        fallback.readerDiagnostic = {
          reader: "LEGACY",
          fallbackUsed: true,
          canonicalEntityCount: 0,
          canonicalRelationshipCount: 0,
          legacyFallbackCount: fallback.nodes.length,
          unresolvedCanonicalReferences: 0,
          details: [
            `canonical read failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          ]
        };
      }
      // Do not cache a fallback response so the next read retries canonical.
      return fallback;
    }
  }

  const topology = await buildLegacyProjectTopology(
    organizationId,
    projectId,
    project
  );
  if (process.env.NODE_ENV !== "production") {
    topology.readerDiagnostic = {
      reader: "LEGACY",
      fallbackUsed: false,
      canonicalEntityCount: 0,
      canonicalRelationshipCount: 0,
      legacyFallbackCount: topology.nodes.length,
      unresolvedCanonicalReferences: 0,
      details: ["canonical read disabled (OPSWATCH_CANONICAL_TOPOLOGY_READ_ENABLED != true)"]
    };
  }
  topologyCache.set(cacheKey, {
    expiresAt: Date.now() + TOPOLOGY_CACHE_TTL_MS,
    value: topology
  });
  return topology;
};

const buildLegacyProjectTopology = async (
  organizationId: string,
  projectId: string,
  project: { id: string; name: string; status: string }
): Promise<ProjectTopologyResponse> => {
  // Lean parallel reads — no nested relation `take` (serializes as N+1 under connection_limit=1).
  const [services, dependencies, alerts, incidents, sloDefinitions, heartbeats] = await Promise.all([
    prisma.service.findMany({
      where: { projectId },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        Check: {
          // Include inactive checks so recent results remain usable as topology evidence
          // when operators pause polling (or local evidence seeds freeze checks).
          select: { id: true, isActive: true }
        }
      },
      orderBy: { name: "asc" }
    }),
    prisma.serviceDependency.findMany({
      where: { projectId, isActive: true },
      select: {
        id: true,
        fromServiceId: true,
        toServiceId: true,
        dependencyType: true,
        criticality: true,
        isActive: true
      }
    }),
    prisma.alert.findMany({
      where: { projectId, status: { in: [...openAlertStatuses] } },
      select: { id: true, title: true, severity: true, status: true, serviceId: true }
    }),
    prisma.incident.findMany({
      where: { projectId, status: { in: [...unresolvedIncidentStatuses] } },
      select: {
        id: true,
        title: true,
        severity: true,
        status: true,
        IncidentAlert: {
          select: {
            Alert: { select: { serviceId: true } }
          }
        }
      }
    }),
    prisma.sLODefinition.findMany({
      where: { projectId, enabled: true, archivedAt: null },
      select: { id: true, serviceId: true }
    }),
    prisma.heartbeat.findMany({
      where: { projectId },
      orderBy: { receivedAt: "desc" },
      take: 12,
      select: { status: true, receivedAt: true }
    })
  ]);

  const checkIds = services.flatMap((service) => service.Check.map((check) => check.id));
  const sloDefinitionIds = sloDefinitions.map((row) => row.id);

  const [resultsByCheckId, latestSloByDefinition] = await Promise.all([
    loadRecentCheckResultsByCheckIds(checkIds, 12),
    loadLatestSloWindowsByDefinitionIds(sloDefinitionIds)
  ]);

  const topology = buildProjectTopologyResponse({
    project,
    services: attachCheckResults(services, resultsByCheckId),
    dependencies,
    alerts,
    incidents: incidents.map((row) => ({
      id: row.id,
      title: row.title,
      severity: row.severity,
      status: row.status,
      serviceIds: Array.from(
        new Set(
          row.IncidentAlert.map((ref) => ref.Alert.serviceId).filter((value): value is string => Boolean(value))
        )
      )
    })),
    slos: sloDefinitions.map((row) => {
      const latest = latestSloByDefinition.get(row.id);
      return {
        serviceId: row.serviceId,
        latestWindow: latest
          ? {
              status: latest.status,
              availabilityPct: latest.availabilityPct,
              errorRatePct: latest.errorRatePct,
              p95LatencyMs: latest.p95LatencyMs,
              burnRate: latest.burnRate
            }
          : null
      };
    }),
    heartbeats
  });

  const otelEntities = await prisma.operationalEntity.findMany({
    where: {
      organizationId,
      projectId,
      discoverySource: "OTEL_BRIDGE",
      entityType: "SERVICE"
    },
    select: {
      id: true,
      name: true,
      legacyServiceId: true,
      health: true,
      healthConfidence: true,
      discoveryState: true,
      signalCount: true,
      lastSeenAt: true,
      freshUntil: true,
      provenance: true
    }
  });
  const otelRelationships = await prisma.operationalRelationship.count({
    where: { organizationId, projectId, provenance: "OTEL_COLLECTOR" }
  });
  const freshSignals = await prisma.normalizedOperationalSignal.count({
    where: {
      organizationId,
      projectId,
      freshUntil: { gt: new Date() }
    }
  });

  const now = Date.now();
  for (const entity of otelEntities) {
    const serviceId = entity.legacyServiceId;
    if (!serviceId || !topology.nodeContext[serviceId]) continue;
    const freshness =
      entity.discoveryState === "INACTIVE"
        ? "INACTIVE"
        : entity.discoveryState === "STALE" || (entity.freshUntil && entity.freshUntil.getTime() < now)
          ? "STALE"
          : entity.freshUntil
            ? "FRESH"
            : "UNKNOWN";
    topology.nodeContext[serviceId] = {
      ...topology.nodeContext[serviceId]!,
      otel: {
        connected: true,
        discoveryState: entity.discoveryState,
        health: entity.health,
        confidence: entity.healthConfidence,
        freshness,
        signalCount: entity.signalCount,
        lastSeenAt: entity.lastSeenAt?.toISOString() ?? null,
        source: entity.provenance
      }
    };
    // Overlay health onto product nodes without replacing the Service model.
    if (entity.health === "CRITICAL" || entity.health === "DEGRADED" || entity.health === "UNKNOWN") {
      const node = topology.nodes.find((row) => row.id === serviceId);
      if (node) {
        const mapped =
          entity.health === "CRITICAL"
            ? ("CRITICAL" as const)
            : entity.health === "DEGRADED"
              ? ("DEGRADED" as const)
              : ("UNKNOWN" as const);
        if (mapped === "CRITICAL") {
          node.status = "CRITICAL";
        } else if (mapped === "DEGRADED" && node.status !== "CRITICAL") {
          node.status = "DEGRADED";
        } else if (mapped === "UNKNOWN" && (node.status === "HEALTHY" || node.status === "UNKNOWN")) {
          node.status = "UNKNOWN";
        }
      }
    }
  }

  // Feed relationship health into existing green/amber/red/grey edge semantics.
  const otelEdges = await prisma.operationalRelationship.findMany({
    where: {
      organizationId,
      projectId,
      provenance: "OTEL_COLLECTOR",
      discoveryState: { in: ["DISCOVERED", "ACTIVE", "STALE"] }
    },
    select: {
      sourceEntityId: true,
      targetEntityId: true,
      health: true,
      discoveryState: true,
      provenance: true,
      Source: { select: { legacyServiceId: true } },
      Target: { select: { legacyServiceId: true } }
    }
  });
  for (const edge of otelEdges) {
    const sourceId = edge.Source.legacyServiceId;
    const targetId = edge.Target.legacyServiceId;
    if (!sourceId || !targetId) continue;
    const topologyEdge = topology.edges.find(
      (row) =>
        row.type === "DEPENDENCY" &&
        ((row.sourceId === sourceId && row.targetId === targetId) ||
          (row.sourceId === targetId && row.targetId === sourceId))
    );
    if (!topologyEdge) continue;
    topologyEdge.otel = {
      source: edge.provenance,
      health: edge.health,
      discoveryState: edge.discoveryState
    };
    if (edge.health === "CRITICAL") topologyEdge.status = "CRITICAL";
    else if (edge.health === "DEGRADED" && topologyEdge.status !== "CRITICAL") {
      topologyEdge.status = "DEGRADED";
    } else if (edge.health === "UNKNOWN" && topologyEdge.status === "HEALTHY") {
      topologyEdge.status = "UNKNOWN";
    }
  }

  topology.otelOverlay = {
    enabled: otelEntities.length > 0 || freshSignals > 0,
    entities: otelEntities.length,
    relationships: otelRelationships,
    freshSignals,
    staleEntities: otelEntities.filter((row) => row.discoveryState === "STALE").length
  };

  return topology;
};
