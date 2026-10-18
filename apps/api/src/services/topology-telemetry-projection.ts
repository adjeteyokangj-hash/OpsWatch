import type { PresentedDevice } from "./device-heartbeat";
import type {
  ProjectTopologyResponse,
  TopologyEdge,
  TopologyHealthStatus,
  TopologyNode,
  TopologyNodeContext
} from "../types/dto";

const emptyMetrics = (): TopologyNode["metrics"] => ({
  availabilityPercent: null,
  latencyMs: null,
  errorRatePercent: null,
  sloBurnRate: null,
  availabilityTrend: []
});

const laneHealth = (
  status: PresentedDevice["lifecycleSync"],
  online: boolean
): TopologyHealthStatus => {
  if (!online) return "UNKNOWN";
  if (status === "FAILED") return "CRITICAL";
  if (status === "DELAYED") return "DEGRADED";
  if (status === "HEALTHY") return "HEALTHY";
  return "UNKNOWN";
};

const worstHealth = (statuses: TopologyHealthStatus[]): TopologyHealthStatus => {
  const rank: Record<TopologyHealthStatus, number> = {
    UNKNOWN: 0,
    HEALTHY: 1,
    DEGRADED: 2,
    CRITICAL: 3
  };
  return statuses.reduce((worst, status) => (rank[status] > rank[worst] ? status : worst), "UNKNOWN");
};

const contextFor = (input: {
  observedAt: string;
  statusLabel: string;
  entityType: string;
  online: boolean;
  downstreamIds?: string[];
  upstreamIds?: string[];
}): TopologyNodeContext => ({
  monitoringState: "MONITORED",
  lastCheckAt: input.observedAt,
  lastCheckStatus: input.statusLabel,
  sloStatus: null,
  recoveryState: null,
  openAlerts: [],
  unresolvedIncidents: [],
  upstreamIds: input.upstreamIds ?? [],
  downstreamIds: input.downstreamIds ?? [],
  canonical: {
    environment: "reported",
    entityType: input.entityType,
    provenance: "HEARTBEAT",
    discoverySource: "DESKTOP_HEARTBEAT",
    discoveryState: input.online ? "ACTIVE" : "STALE",
    freshness: input.online ? "FRESH" : "STALE",
    confidence: input.online ? 1 : 0.4,
    confirmationState: "CONFIRMED",
    sharedScope: "PROJECT",
    isTestSeed: false,
    legacyServiceId: null,
    location: null
  }
});

const recount = (topology: ProjectTopologyResponse): ProjectTopologyResponse["summary"] => ({
  total: topology.nodes.length,
  healthy: topology.nodes.filter((node) => node.status === "HEALTHY").length,
  degraded: topology.nodes.filter((node) => node.status === "DEGRADED").length,
  critical: topology.nodes.filter((node) => node.status === "CRITICAL").length,
  unknown: topology.nodes.filter((node) => node.status === "UNKNOWN").length,
  openAlerts: topology.summary.openAlerts,
  openIncidents: topology.summary.openIncidents
});

/**
 * Read-time projection of computers and the two sync lanes already present on
 * a desktop heartbeat. Offline is presence only: this does not create alerts
 * or incidents. Lane names stay generic; an application manifest binds them
 * to product modules later.
 */
export const projectDeviceTelemetry = (
  topology: ProjectTopologyResponse,
  devices: readonly PresentedDevice[]
): ProjectTopologyResponse => {
  if (devices.length === 0) return topology;

  const nodes = [...topology.nodes];
  const edges = [...topology.edges];
  const nodeContext = { ...topology.nodeContext };
  const existingIds = new Set(nodes.map((node) => node.id));
  const appNodes = nodes.filter((node) => node.type === "APP");
  const appId = appNodes.length === 1 ? appNodes[0]!.id : null;

  for (const device of devices) {
    const installationId = `installation:${device.deviceId}`;
    const lifecycleId = `sync:${device.deviceId}:lifecycle`;
    const financialId = `sync:${device.deviceId}:financial`;
    if (existingIds.has(installationId) || existingIds.has(lifecycleId) || existingIds.has(financialId)) {
      continue;
    }

    const online = device.presence === "ONLINE";
    const lifecycle = laneHealth(device.lifecycleSync, online);
    const financial = laneHealth(device.financialSync, online);
    const installationStatus = online ? worstHealth([lifecycle, financial]) : "UNKNOWN";
    const versionLabel = device.appVersion ? ` · ${device.appVersion}` : "";
    const presenceLabel = `${online ? "ONLINE" : "OFFLINE"}${versionLabel}`;

    const installation: TopologyNode = {
      id: installationId,
      name: device.displayName,
      type: "COMPONENT",
      status: installationStatus,
      parentId: appId,
      metrics: emptyMetrics(),
      risk: { openAlerts: 0, unresolvedIncidents: 0 }
    };
    const lifecycleNode: TopologyNode = {
      id: lifecycleId,
      name: "Lifecycle synchronisation",
      type: "WORKFLOW",
      status: lifecycle,
      parentId: installationId,
      metrics: emptyMetrics(),
      risk: { openAlerts: 0, unresolvedIncidents: 0 }
    };
    const financialNode: TopologyNode = {
      id: financialId,
      name: "Financial synchronisation",
      type: "WORKFLOW",
      status: financial,
      parentId: installationId,
      metrics: emptyMetrics(),
      risk: { openAlerts: 0, unresolvedIncidents: 0 }
    };

    nodes.push(installation, lifecycleNode, financialNode);
    existingIds.add(installationId);
    existingIds.add(lifecycleId);
    existingIds.add(financialId);

    const hierarchy = (
      id: string,
      sourceId: string,
      targetId: string,
      status: TopologyHealthStatus
    ): TopologyEdge => ({
      id,
      sourceId,
      targetId,
      type: "HIERARCHY",
      critical: false,
      status,
      provenance: "HEARTBEAT",
      confidence: online ? 1 : 0.4,
      discoveryState: online ? "ACTIVE" : "STALE",
      freshness: online ? "FRESH" : "STALE",
      confirmationState: "CONFIRMED"
    });

    edges.push(
      hierarchy(`sync-link:${device.deviceId}:lifecycle`, lifecycleId, installationId, lifecycle),
      hierarchy(`sync-link:${device.deviceId}:financial`, financialId, installationId, financial)
    );
    if (appId) {
      edges.push(hierarchy(`installation-link:${device.deviceId}`, installationId, appId, installationStatus));
    }

    nodeContext[installationId] = contextFor({
      observedAt: device.lastSeenAt,
      statusLabel: presenceLabel,
      entityType: "INSTALLATION",
      online,
      downstreamIds: [lifecycleId, financialId]
    });
    nodeContext[lifecycleId] = contextFor({
      observedAt: device.lastSeenAt,
      statusLabel: online ? device.lifecycleSync : "UNKNOWN",
      entityType: "SYNC_LANE",
      online,
      upstreamIds: [installationId]
    });
    nodeContext[financialId] = contextFor({
      observedAt: device.lastSeenAt,
      statusLabel: online ? device.financialSync : "UNKNOWN",
      entityType: "SYNC_LANE",
      online,
      upstreamIds: [installationId]
    });
  }

  const next = { ...topology, nodes, edges, nodeContext };
  return { ...next, summary: recount(next) };
};
