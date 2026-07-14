import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { ProjectTopologyResponse } from "../types/dto";
import { loadRecentCheckResultsByCheckIds } from "./check-result-batch.service";
import { buildProjectTopologyResponse, type TopologyServiceRecord } from "./topology.service";

const unresolvedIncidentStatuses = ["OPEN", "INVESTIGATING", "MONITORING"] as const;
const openAlertStatuses = ["OPEN", "ACKNOWLEDGED"] as const;

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
  const cacheKey = `${organizationId}:${projectId}`;
  const cached = topologyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true, name: true, status: true }
  });
  if (!project) return null;

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
          where: { isActive: true },
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

  topologyCache.set(cacheKey, {
    expiresAt: Date.now() + TOPOLOGY_CACHE_TTL_MS,
    value: topology
  });

  return topology;
};
