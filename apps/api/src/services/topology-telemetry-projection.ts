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
  const boundLanes = new Set(
    Object.values(nodeContext)
      .map((context) => context.manifest?.healthBinding)
      .filter((binding) => binding?.signal === "heartbeat_lane" && binding.lane)
      .map((binding) => binding!.lane)
  );

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
    confidence: 1,
    discoveryState: "ACTIVE",
    freshness: "FRESH",
    confirmationState: "CONFIRMED"
  });

  for (const device of devices) {
    const installationId = `installation:${device.deviceId}`;
    if (existingIds.has(installationId)) continue;

    const online = device.presence === "ONLINE";
    const installationStatus: TopologyHealthStatus = online ? "HEALTHY" : "UNKNOWN";
    const versionLabel = device.appVersion ? ` · ${device.appVersion}` : "";
    const propertyKey = device.propertyId?.toLowerCase() ?? null;
    const propertyParent = propertyKey
      ? nodes.find((node) => nodeContext[node.id]?.manifest?.externalId?.toLowerCase() === propertyKey)
      : undefined;
    const parentId = propertyParent?.id ?? appId;
    const presenceLabel = `${online ? "ONLINE" : "OFFLINE"}${versionLabel}`;

    const installation: TopologyNode = {
      id: installationId,
      name: device.displayName,
      type: "COMPONENT",
      status: installationStatus,
      parentId,
      kind: "installation",
      metrics: emptyMetrics(),
      risk: { openAlerts: 0, unresolvedIncidents: 0 }
    };
    nodes.push(installation);
    existingIds.add(installationId);

    const laneNodes: TopologyNode[] = [];
    if (!boundLanes.has("lifecycle")) {
      laneNodes.push({
        id: `sync:${device.deviceId}:lifecycle`,
        name: "Lifecycle synchronisation",
        type: "WORKFLOW",
        status: laneHealth(device.lifecycleSync, online),
        parentId: installationId,
        kind: "workflow",
        metrics: emptyMetrics(),
        risk: { openAlerts: 0, unresolvedIncidents: 0 }
      });
    }
    if (!boundLanes.has("financial")) {
      laneNodes.push({
        id: `sync:${device.deviceId}:financial`,
        name: "Financial synchronisation",
        type: "WORKFLOW",
        status: laneHealth(device.financialSync, online),
        parentId: installationId,
        kind: "workflow",
        metrics: emptyMetrics(),
        risk: { openAlerts: 0, unresolvedIncidents: 0 }
      });
    }
    for (const laneNode of laneNodes) {
      if (existingIds.has(laneNode.id)) continue;
      nodes.push(laneNode);
      existingIds.add(laneNode.id);
      edges.push(hierarchy(
        `sync-link:${laneNode.id}`,
        laneNode.id,
        installationId,
        laneNode.status
      ));
      nodeContext[laneNode.id] = {
        ...contextFor({
          observedAt: device.lastSeenAt,
          statusLabel: online ? (laneNode.name.startsWith("Lifecycle") ? device.lifecycleSync : device.financialSync) : "UNKNOWN",
          entityType: "SYNC_LANE",
          online,
          upstreamIds: [installationId]
        }),
        manifest: {
          kind: "workflow",
          category: "sync",
          externalId: null,
          healthBinding: null,
          evidence: online ? "measured" : "missing",
          lastSuccessAt: online && laneNode.status === "HEALTHY" ? device.lastSeenAt : null,
          lastFailureAt: online && laneNode.status !== "HEALTHY" && laneNode.status !== "UNKNOWN" ? device.lastSeenAt : null,
          computers: [],
          potentialImpact: []
        }
      };
    }

    if (parentId) {
      edges.push(hierarchy(`installation-link:${device.deviceId}`, installationId, parentId, installationStatus));
    }

    nodeContext[installationId] = contextFor({
      observedAt: device.lastSeenAt,
      statusLabel: presenceLabel,
      entityType: "INSTALLATION",
      online,
      downstreamIds: laneNodes.map((lane) => lane.id)
    });
    nodeContext[installationId] = {
      ...nodeContext[installationId]!,
      manifest: {
        kind: "installation",
        category: "installation",
        externalId: device.propertyId,
        healthBinding: null,
        evidence: online ? "measured" : "missing",
        lastSuccessAt: online ? device.lastSeenAt : device.lastSuccessfulSyncAt,
        lastFailureAt: null,
        computers: [{
          displayName: device.displayName,
          presence: device.presence,
          appVersion: device.appVersion,
          lifecycleSync: device.lifecycleSync,
          financialSync: device.financialSync,
          lastSeenAt: device.lastSeenAt
        }],
        potentialImpact: []
      }
    };
  }

  const next = { ...topology, nodes, edges, nodeContext };
  return { ...next, summary: recount(next) };
};
