import type { PresentedDevice } from "./device-heartbeat";
import type {
  ProjectTopologyResponse,
  TopologyHealthStatus,
  TopologyNodeContext
} from "../types/dto";

export type TopologyCheckEvidence = {
  name: string;
  status: "PASS" | "WARN" | "FAIL" | string | null;
  checkedAt: string | null;
};

const laneRank = (status: string | null | undefined): TopologyHealthStatus => {
  if (status === "FAILED") return "CRITICAL";
  if (status === "DELAYED") return "DEGRADED";
  if (status === "HEALTHY") return "HEALTHY";
  return "UNKNOWN";
};

const worst = (statuses: TopologyHealthStatus[]): TopologyHealthStatus => {
  const rank: Record<TopologyHealthStatus, number> = {
    UNKNOWN: 0,
    HEALTHY: 1,
    DEGRADED: 2,
    CRITICAL: 3
  };
  return statuses.reduce((current, status) => (rank[status] > rank[current] ? status : current), "UNKNOWN");
};

const checkHealth = (status: string | null | undefined): TopologyHealthStatus => {
  if (status === "PASS") return "HEALTHY";
  if (status === "WARN") return "DEGRADED";
  if (status === "FAIL") return "CRITICAL";
  return "UNKNOWN";
};

const emptyManifest = (): NonNullable<TopologyNodeContext["manifest"]> => ({
  kind: null,
  category: null,
  externalId: null,
  healthBinding: null,
  evidence: "missing",
  lastSuccessAt: null,
  lastFailureAt: null,
  computers: [],
  potentialImpact: []
});

const computerRows = (devices: readonly PresentedDevice[]) =>
  devices.map((device) => ({
    displayName: device.displayName,
    presence: device.presence,
    appVersion: device.appVersion,
    lifecycleSync: device.lifecycleSync,
    financialSync: device.financialSync,
    lastSeenAt: device.lastSeenAt
  }));

/**
 * Paint only the component named by a health binding.
 * A failed sync lane does not reclassify the modules it synchronises.
 */
export const applyDeclaredHealth = (
  topology: ProjectTopologyResponse,
  devices: readonly PresentedDevice[],
  checks: readonly TopologyCheckEvidence[] = []
): ProjectTopologyResponse => {
  const nodes = topology.nodes.map((node) => ({ ...node }));
  const nodeContext = { ...topology.nodeContext };
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const online = devices.filter((device) => device.presence === "ONLINE");

  for (const node of nodes) {
    const manifest = nodeContext[node.id]?.manifest;
    if (!manifest?.healthBinding) continue;
    const binding = manifest.healthBinding;
    let status: TopologyHealthStatus = "UNKNOWN";
    let lastSuccessAt: string | null = null;
    let lastFailureAt: string | null = null;
    let evidence: "measured" | "missing" = "missing";

    if (binding.signal === "heartbeat_lane" && binding.lane) {
      const lane = binding.lane;
      if (online.length === 0) {
        status = "UNKNOWN";
      } else {
        const measured = online.map((device) => laneRank(lane === "lifecycle" ? device.lifecycleSync : device.financialSync));
        status = worst(measured);
        evidence = "measured";
        const newest = [...online].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0];
        if (status === "HEALTHY") lastSuccessAt = newest?.lastSuccessfulSyncAt ?? newest?.lastSeenAt ?? null;
        if (status === "CRITICAL" || status === "DEGRADED") lastFailureAt = newest?.lastSeenAt ?? null;
      }
    } else if (binding.signal === "http_check" && binding.checkName) {
      const match = checks.find((check) => check.name === binding.checkName);
      status = checkHealth(match?.status);
      evidence = match?.status ? "measured" : "missing";
      if (status === "HEALTHY") lastSuccessAt = match?.checkedAt ?? null;
      if (status === "CRITICAL" || status === "DEGRADED") lastFailureAt = match?.checkedAt ?? null;
    }

    node.status = status;
    nodeContext[node.id] = {
      ...nodeContext[node.id]!,
      monitoringState: evidence === "measured" ? "MONITORED" : nodeContext[node.id]!.monitoringState,
      lastCheckAt: lastSuccessAt ?? lastFailureAt ?? nodeContext[node.id]!.lastCheckAt,
      lastCheckStatus: evidence === "measured" ? status : "No monitoring evidence",
      manifest: {
        ...manifest,
        evidence,
        lastSuccessAt,
        lastFailureAt,
        computers: computerRows(devices)
      }
    };
  }

  for (const edge of topology.edges) {
    if (edge.type === "HIERARCHY") continue;
    const relation = (edge.relationshipType ?? edge.type).toUpperCase();
    const source = byId.get(edge.sourceId);
    const target = byId.get(edge.targetId);
    if (!source || !target) continue;
    const sourceContext = nodeContext[source.id];
    const targetContext = nodeContext[target.id];
    if (!sourceContext?.manifest || !targetContext?.manifest) continue;

    const note = (id: string, name: string, health: TopologyHealthStatus, via: string) => ({ id, name, via, health });
    if ((relation === "DEPENDS_ON" || relation === "RUNS_ON") && (target.status === "CRITICAL" || target.status === "DEGRADED")) {
      sourceContext.manifest = {
        ...sourceContext.manifest,
        potentialImpact: [
          ...sourceContext.manifest.potentialImpact,
          note(target.id, target.name, target.status, relation)
        ]
      };
    }
    if (relation === "SYNCS" && (source.status === "CRITICAL" || source.status === "DEGRADED")) {
      targetContext.manifest = {
        ...targetContext.manifest,
        potentialImpact: [
          ...targetContext.manifest.potentialImpact,
          note(source.id, source.name, source.status, relation)
        ]
      };
    }
  }

  const summary = {
    total: nodes.length,
    healthy: nodes.filter((node) => node.status === "HEALTHY").length,
    degraded: nodes.filter((node) => node.status === "DEGRADED").length,
    critical: nodes.filter((node) => node.status === "CRITICAL").length,
    unknown: nodes.filter((node) => node.status === "UNKNOWN").length,
    openAlerts: topology.summary.openAlerts,
    openIncidents: topology.summary.openIncidents
  };

  return { ...topology, nodes, nodeContext, summary };
};
