import type { ServiceType } from "@prisma/client";
import type {
  ProjectTopologyResponse,
  TopologyEdge,
  TopologyHealthStatus,
  TopologyNode,
  TopologyNodeContext,
  TopologyNodeType,
  TopologySummary
} from "../types/dto";
import {
  resolveDependencyEdgeHealth,
  resolveMonitoringState,
  resolveServiceHealth,
  type ServiceHealthSignals
} from "./service-health.service";

const FOUR_LAYER_TYPES = new Set<TopologyNodeType>(["APP", "MODULE", "WORKFLOW", "COMPONENT"]);

export const mapServiceTypeToTopology = (type: ServiceType): TopologyNodeType =>
  FOUR_LAYER_TYPES.has(type as TopologyNodeType) ? (type as TopologyNodeType) : "COMPONENT";

export type TopologyServiceRecord = {
  id: string;
  name: string;
  type: ServiceType;
  status: string;
  Check: Array<{
    isActive: boolean;
    CheckResult: Array<{ status: string; checkedAt: Date; responseTimeMs: number | null }>;
  }>;
};

export type TopologyDependencyRecord = {
  id: string;
  fromServiceId: string;
  toServiceId: string;
  dependencyType: string;
  criticality: string;
  isActive: boolean;
};

export type TopologyAlertRecord = {
  id: string;
  title: string;
  severity: string;
  status: string;
  serviceId: string | null;
};

export type TopologyIncidentRecord = {
  id: string;
  title: string;
  severity: string;
  status: string;
  serviceIds: string[];
};

export type TopologySloRecord = {
  serviceId: string | null;
  latestWindow: {
    status: string;
    availabilityPct: number | null;
    errorRatePct: number | null;
    p95LatencyMs: number | null;
    burnRate: number | null;
  } | null;
};

export type TopologyBuildInput = {
  project: { id: string; name: string; status: string };
  services: TopologyServiceRecord[];
  dependencies: TopologyDependencyRecord[];
  alerts: TopologyAlertRecord[];
  incidents: TopologyIncidentRecord[];
  slos: TopologySloRecord[];
  generatedAt?: Date;
};

const isCriticalAlert = (severity: string): boolean => severity === "CRITICAL" || severity === "HIGH";

const buildServiceSignals = (
  service: TopologyServiceRecord,
  alerts: TopologyAlertRecord[],
  incidents: TopologyIncidentRecord[],
  slo: TopologySloRecord | undefined
): ServiceHealthSignals => {
  const activeChecks = service.Check.filter((row) => row.isActive);
  const latestResults = activeChecks
    .map((row) => row.CheckResult[0] ?? null)
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const hasCompletedCheck = latestResults.length > 0;
  const latestCheckFailed = latestResults.some((row) => row.status === "FAIL");

  const serviceAlerts = alerts.filter((row) => row.serviceId === service.id);
  const serviceIncidents = incidents.filter((row) => row.serviceIds.includes(service.id));

  return {
    storedStatus: service.status,
    activeCheckCount: activeChecks.length,
    hasCompletedCheck,
    latestCheckFailed,
    openAlerts: serviceAlerts.length,
    criticalOpenAlerts: serviceAlerts.filter((row) => isCriticalAlert(row.severity)).length,
    unresolvedIncidents: serviceIncidents.length,
    sloStatus: slo?.latestWindow?.status ?? null
  };
};

const latestCheckForService = (service: TopologyServiceRecord) => {
  const results = service.Check.flatMap((row) => row.CheckResult);
  if (results.length === 0) return null;
  return [...results].sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime())[0] ?? null;
};

const sloForService = (slos: TopologySloRecord[], serviceId: string) =>
  slos.find((row) => row.serviceId === serviceId);

export const buildProjectTopologyResponse = (input: TopologyBuildInput): ProjectTopologyResponse => {
  const healthByService = new Map<string, TopologyHealthStatus>();
  const signalsByService = new Map<string, ServiceHealthSignals>();
  const nodeContext: Record<string, TopologyNodeContext> = {};

  const hierarchyParents = new Map<string, string>();
  for (const edge of input.dependencies) {
    if (edge.isActive && edge.dependencyType.toUpperCase() === "HIERARCHY") {
      hierarchyParents.set(edge.fromServiceId, edge.toServiceId);
    }
  }

  const upstreamMap = new Map<string, string[]>();
  const downstreamMap = new Map<string, string[]>();
  for (const edge of input.dependencies) {
    if (!edge.isActive || edge.dependencyType.toUpperCase() === "HIERARCHY") continue;
    upstreamMap.set(edge.fromServiceId, [...(upstreamMap.get(edge.fromServiceId) ?? []), edge.toServiceId]);
    downstreamMap.set(edge.toServiceId, [...(downstreamMap.get(edge.toServiceId) ?? []), edge.fromServiceId]);
  }

  for (const service of input.services) {
    const signals = buildServiceSignals(
      service,
      input.alerts,
      input.incidents,
      sloForService(input.slos, service.id)
    );
    signalsByService.set(service.id, signals);
    healthByService.set(service.id, resolveServiceHealth(signals));

    const latestCheck = latestCheckForService(service);
    const slo = sloForService(input.slos, service.id);
    nodeContext[service.id] = {
      monitoringState: resolveMonitoringState(signals),
      lastCheckAt: latestCheck?.checkedAt.toISOString() ?? null,
      lastCheckStatus: latestCheck?.status ?? null,
      sloStatus: slo?.latestWindow?.status ?? null,
      openAlerts: input.alerts
        .filter((row) => row.serviceId === service.id)
        .map((row) => ({ id: row.id, title: row.title, severity: row.severity, status: row.status })),
      unresolvedIncidents: input.incidents
        .filter((row) => row.serviceIds.includes(service.id))
        .map((row) => ({ id: row.id, title: row.title, severity: row.severity, status: row.status })),
      upstreamIds: upstreamMap.get(service.id) ?? [],
      downstreamIds: downstreamMap.get(service.id) ?? []
    };
  }

  const nodes: TopologyNode[] = input.services.map((service) => {
    const slo = sloForService(input.slos, service.id);
    const signals = signalsByService.get(service.id)!;
    return {
      id: service.id,
      name: service.name,
      type: mapServiceTypeToTopology(service.type),
      status: healthByService.get(service.id)!,
      parentId: hierarchyParents.get(service.id) ?? null,
      metrics: {
        availabilityPercent: slo?.latestWindow?.availabilityPct ?? null,
        latencyMs: slo?.latestWindow?.p95LatencyMs ?? null,
        errorRatePercent: slo?.latestWindow?.errorRatePct ?? null,
        sloBurnRate: slo?.latestWindow?.burnRate ?? null
      },
      risk: {
        openAlerts: signals.openAlerts,
        unresolvedIncidents: signals.unresolvedIncidents
      }
    };
  });

  const edges: TopologyEdge[] = input.dependencies
    .filter((row) => row.isActive)
    .map((row) => {
      const isHierarchy = row.dependencyType.toUpperCase() === "HIERARCHY";
      const critical = row.criticality.toUpperCase() === "CRITICAL" || row.criticality.toUpperCase() === "HIGH";
      const targetHealth = healthByService.get(row.toServiceId) ?? "UNKNOWN";
      return {
        id: row.id,
        sourceId: row.fromServiceId,
        targetId: row.toServiceId,
        type: isHierarchy ? "HIERARCHY" : "DEPENDENCY",
        critical,
        status: isHierarchy
          ? targetHealth
          : resolveDependencyEdgeHealth(targetHealth, critical)
      } satisfies TopologyEdge;
    });

  const summary: TopologySummary = {
    total: nodes.length,
    healthy: nodes.filter((row) => row.status === "HEALTHY").length,
    degraded: nodes.filter((row) => row.status === "DEGRADED").length,
    critical: nodes.filter((row) => row.status === "CRITICAL").length,
    unknown: nodes.filter((row) => row.status === "UNKNOWN").length,
    openAlerts: input.alerts.length,
    openIncidents: input.incidents.length
  };

  return {
    project: {
      id: input.project.id,
      name: input.project.name,
      status: input.project.status
    },
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    nodes,
    edges,
    summary,
    nodeContext
  };
};
