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
  resolveMonitoringState,
  resolveRelationshipEdgeHealth,
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

const EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const buildServiceSignals = (
  service: TopologyServiceRecord,
  alerts: TopologyAlertRecord[],
  incidents: TopologyIncidentRecord[],
  slo: TopologySloRecord | undefined
): ServiceHealthSignals => {
  // Prefer the newest fresh result across checks (active preferred when present).
  const activeChecks = service.Check.filter((row) => row.isActive);
  const checksForEvidence = activeChecks.length > 0 ? activeChecks : service.Check;
  const freshResults = checksForEvidence
    .flatMap((row) => row.CheckResult)
    .filter((row) => Date.now() - row.checkedAt.getTime() <= EVIDENCE_MAX_AGE_MS)
    .sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime());
  const newest = freshResults[0] ?? null;
  const hasCompletedCheck = newest != null;
  const latestCheckFailed = newest?.status === "FAIL" || newest?.status === "WARN";

  const serviceAlerts = alerts.filter((row) => row.serviceId === service.id);
  const serviceIncidents = incidents.filter((row) => row.serviceIds.includes(service.id));

  return {
    storedStatus: service.status,
    activeCheckCount: activeChecks.length > 0 ? activeChecks.length : hasCompletedCheck ? 1 : 0,
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
    const isApp = mapServiceTypeToTopology(service.type) === "APP";
    const latestHeartbeat = isApp ? input.heartbeats?.[0] ?? null : null;
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

  // Keep service health map aligned with post-rollup node status (edges must not use pre-rollup values).
  for (const node of nodes) {
    healthByService.set(node.id, node.status);
  }

  for (const node of nodes) {
    if (node.metrics.availabilityPercent == null) continue;
    const context = nodeContext[node.id];
    if (context && context.monitoringState === "AWAITING_FIRST_CHECK") {
      context.monitoringState = "MONITORED";
    }
  }

  const statusById = new Map(nodes.map((row) => [row.id, row.status] as const));
  const serviceById = new Map(input.services.map((row) => [row.id, row] as const));

  const endpointCheckCounts = (serviceId: string) => {
    const service = serviceById.get(serviceId);
    if (!service) return { failed: 0, warn: 0, hasEvidence: false };
    const active = service.Check.filter((row) => row.isActive);
    const checksForEvidence = active.length > 0 ? active : service.Check;
    const fresh = checksForEvidence
      .flatMap((row) => row.CheckResult)
      .filter((row) => Date.now() - row.checkedAt.getTime() <= EVIDENCE_MAX_AGE_MS)
      .sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime());
    const newest = fresh[0] ?? null;
    return {
      failed: newest?.status === "FAIL" ? 1 : 0,
      warn: newest?.status === "WARN" ? 1 : 0,
      hasEvidence: newest != null
    };
  };

  const edges: TopologyEdge[] = input.dependencies
    .filter((row) => row.isActive)
    .map((row) => {
      const isHierarchy = row.dependencyType.toUpperCase() === "HIERARCHY";
      const critical = row.criticality.toUpperCase() === "CRITICAL" || row.criticality.toUpperCase() === "HIGH";
      const sourceHealth = statusById.get(row.fromServiceId) ?? "UNKNOWN";
      const targetHealth = statusById.get(row.toServiceId) ?? "UNKNOWN";
      const sourceChecks = endpointCheckCounts(row.fromServiceId);
      const targetChecks = endpointCheckCounts(row.toServiceId);
      const relatedAlerts = input.alerts.filter(
        (alert) => alert.serviceId === row.fromServiceId || alert.serviceId === row.toServiceId
      );
      const relatedCriticalAlerts = relatedAlerts.filter((alert) => isCriticalAlert(alert.severity)).length;
      const sourceSignals = signalsByService.get(row.fromServiceId);
      const targetSignals = signalsByService.get(row.toServiceId);
      const hasTargetEvidence =
        targetChecks.hasEvidence ||
        (targetSignals != null && resolveMonitoringState(targetSignals) === "MONITORED") ||
        (targetHealth !== "UNKNOWN" && (nodeContext[row.toServiceId]?.monitoringState === "MONITORED"));
      const hasAnyEndpointEvidence =
        hasTargetEvidence ||
        sourceChecks.hasEvidence ||
        (sourceSignals != null && resolveMonitoringState(sourceSignals) === "MONITORED") ||
        sourceHealth !== "UNKNOWN";

      if (isHierarchy) {
        // Hierarchy is containment — status still reflects rolled-up parent evidence for drawers/tooltips.
        // Canvas paints hierarchy as documented grey dashed regardless of this value.
        return {
          id: row.id,
          sourceId: row.fromServiceId,
          targetId: row.toServiceId,
          type: "HIERARCHY" as const,
          critical,
          status: targetHealth
        } satisfies TopologyEdge;
      }

      const resolved = resolveRelationshipEdgeHealth({
        sourceHealth,
        targetHealth,
        relatedOpenAlerts: relatedAlerts.length,
        relatedCriticalAlerts,
        // Dependency colour is driven by the callee/target evidence first.
        relatedFailedChecks: targetChecks.failed,
        relatedWarnChecks: targetChecks.warn,
        hasTargetEvidence,
        hasAnyEndpointEvidence
      });

      return {
        id: row.id,
        sourceId: row.fromServiceId,
        targetId: row.toServiceId,
        type: "DEPENDENCY" as const,
        critical,
        status: resolved.status
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
