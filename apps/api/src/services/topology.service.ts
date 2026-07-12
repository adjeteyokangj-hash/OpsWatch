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
  worstHealth,
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

export type TopologyHeartbeatRecord = {
  status: string;
  receivedAt: Date;
};

export type TopologyBuildInput = {
  project: { id: string; name: string; status: string };
  services: TopologyServiceRecord[];
  dependencies: TopologyDependencyRecord[];
  alerts: TopologyAlertRecord[];
  incidents: TopologyIncidentRecord[];
  slos: TopologySloRecord[];
  heartbeats?: TopologyHeartbeatRecord[];
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
  const results = recentCheckResults(service);
  return results[0] ?? null;
};

const recentCheckResults = (service: TopologyServiceRecord) =>
  service.Check.flatMap((row) => row.CheckResult).sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime());

const checkStatusScore = (status: string): number => {
  if (status === "PASS") return 100;
  if (status === "WARN") return 65;
  if (status === "FAIL") return 0;
  return 50;
};

const metricsFromChecks = (service: TopologyServiceRecord) => {
  const results = recentCheckResults(service).slice(0, 12);
  if (results.length === 0) {
    return {
      availabilityPercent: null as number | null,
      latencyMs: null as number | null,
      errorRatePercent: null as number | null,
      availabilityTrend: [] as number[]
    };
  }

  const passCount = results.filter((row) => row.status === "PASS").length;
  const failCount = results.filter((row) => row.status === "FAIL").length;
  const latencySamples = results
    .map((row) => row.responseTimeMs)
    .filter((value): value is number => value != null && Number.isFinite(value));

  return {
    availabilityPercent: Number(((passCount / results.length) * 100).toFixed(2)),
    latencyMs:
      latencySamples.length > 0
        ? Math.round(latencySamples.reduce((sum, value) => sum + value, 0) / latencySamples.length)
        : null,
    errorRatePercent: Number(((failCount / results.length) * 100).toFixed(2)),
    availabilityTrend: [...results].reverse().map((row) => checkStatusScore(row.status))
  };
};

const heartbeatStatusScore = (status: string): number => {
  const normalized = status.toUpperCase();
  if (normalized === "UP" || normalized === "HEALTHY" || normalized === "OK") return 100;
  if (normalized === "DEGRADED" || normalized === "WARN") return 65;
  if (normalized === "DOWN" || normalized === "FAIL" || normalized === "CRITICAL") return 0;
  return 50;
};

const metricsFromHeartbeats = (heartbeats: TopologyHeartbeatRecord[]) => {
  const recent = heartbeats.slice(0, 12);
  if (recent.length === 0) {
    return {
      availabilityPercent: null as number | null,
      latencyMs: null as number | null,
      errorRatePercent: null as number | null,
      availabilityTrend: [] as number[]
    };
  }

  const healthyCount = recent.filter((row) => heartbeatStatusScore(row.status) >= 65).length;
  const failingCount = recent.filter((row) => heartbeatStatusScore(row.status) === 0).length;

  return {
    availabilityPercent: Number(((healthyCount / recent.length) * 100).toFixed(2)),
    latencyMs: null,
    errorRatePercent: Number(((failingCount / recent.length) * 100).toFixed(2)),
    availabilityTrend: [...recent].reverse().map((row) => heartbeatStatusScore(row.status))
  };
};

const averageMetric = (values: number[]): number | null => {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
};

const rollupChildMetrics = (nodes: TopologyNode[], dependencies: TopologyDependencyRecord[]): void => {
  const nodeById = new Map(nodes.map((row) => [row.id, row]));
  const childrenByParent = new Map<string, string[]>();

  for (const edge of dependencies) {
    if (!edge.isActive || edge.dependencyType.toUpperCase() !== "HIERARCHY") continue;
    childrenByParent.set(edge.toServiceId, [...(childrenByParent.get(edge.toServiceId) ?? []), edge.fromServiceId]);
  }

  const rollupOrder: TopologyNodeType[] = ["COMPONENT", "WORKFLOW", "MODULE", "APP"];

  for (const type of rollupOrder) {
    for (const node of nodes.filter((row) => row.type === type)) {
      if (node.metrics.availabilityPercent != null) continue;

      const childIds = childrenByParent.get(node.id) ?? [];
      const children = childIds
        .map((id) => nodeById.get(id))
        .filter((row): row is TopologyNode => Boolean(row));
      const withAvailability = children.filter((row) => row.metrics.availabilityPercent != null);
      if (withAvailability.length === 0) continue;

      node.metrics.availabilityPercent = averageMetric(
        withAvailability.map((row) => row.metrics.availabilityPercent!)
      );

      const latencyValues = children
        .map((row) => row.metrics.latencyMs)
        .filter((value): value is number => value != null);
      node.metrics.latencyMs =
        latencyValues.length > 0
          ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length)
          : null;

      const errorValues = children
        .map((row) => row.metrics.errorRatePercent)
        .filter((value): value is number => value != null);
      node.metrics.errorRatePercent = averageMetric(errorValues);

      const trends = children
        .map((row) => row.metrics.availabilityTrend)
        .filter((trend) => trend.length > 0);
      if (trends.length > 0) {
        const maxLen = Math.max(...trends.map((trend) => trend.length));
        node.metrics.availabilityTrend = Array.from({ length: maxLen }, (_, index) => {
          const samples = trends
            .map((trend) => trend[index])
            .filter((value): value is number => value != null);
          return samples.length > 0 ? averageMetric(samples)! : 50;
        });
      }

      if (node.status === "UNKNOWN") {
        node.status = worstHealth(children.map((row) => row.status));
      }
    }
  }
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
    const latestHeartbeat = input.heartbeats?.[0] ?? null;
    nodeContext[service.id] = {
      monitoringState: resolveMonitoringState(signals),
      lastCheckAt: latestCheck?.checkedAt.toISOString() ?? latestHeartbeat?.receivedAt.toISOString() ?? null,
      lastCheckStatus: latestCheck?.status ?? latestHeartbeat?.status ?? null,
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
    const checkMetrics = metricsFromChecks(service);
    const heartbeatMetrics = metricsFromHeartbeats(input.heartbeats ?? []);
    const isApp = mapServiceTypeToTopology(service.type) === "APP";
    const liveMetrics =
      checkMetrics.availabilityPercent != null
        ? checkMetrics
        : isApp && heartbeatMetrics.availabilityPercent != null
          ? heartbeatMetrics
          : checkMetrics;

    return {
      id: service.id,
      name: service.name,
      type: mapServiceTypeToTopology(service.type),
      status: healthByService.get(service.id)!,
      parentId: hierarchyParents.get(service.id) ?? null,
      metrics: {
        availabilityPercent: slo?.latestWindow?.availabilityPct ?? liveMetrics.availabilityPercent,
        latencyMs: slo?.latestWindow?.p95LatencyMs ?? liveMetrics.latencyMs,
        errorRatePercent: slo?.latestWindow?.errorRatePct ?? liveMetrics.errorRatePercent,
        sloBurnRate: slo?.latestWindow?.burnRate ?? null,
        availabilityTrend: liveMetrics.availabilityTrend
      },
      risk: {
        openAlerts: signals.openAlerts,
        unresolvedIncidents: signals.unresolvedIncidents
      }
    };
  });

  rollupChildMetrics(nodes, input.dependencies);

  for (const node of nodes) {
    if (node.metrics.availabilityPercent == null) continue;
    const context = nodeContext[node.id];
    if (context && context.monitoringState === "AWAITING_FIRST_CHECK") {
      context.monitoringState = "MONITORED";
    }
  }

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
