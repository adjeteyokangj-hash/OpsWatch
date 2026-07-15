import type { ProjectTopologyResponse, TopologyEdge, TopologyNode } from "./topology-types";
import { classifyVisualLayer } from "./topology-visual-layers";

export type RelationshipConnectionState = "connected" | "intentionally_isolated" | "discovery_incomplete";

export type NodeRelationshipDiagnostic = {
  moduleId: string;
  moduleName: string;
  nodeType: TopologyNode["type"];
  visualLayer: string;
  incomingRelationshipCount: number;
  outgoingRelationshipCount: number;
  totalRelationshipCount: number;
  discoverySource: "declared" | "monitored-area" | "unknown";
  relationshipConfidence: "confirmed" | "inferred" | "insufficient";
  lastRelationshipDiscoveryTime: string | null;
  connectionState: RelationshipConnectionState;
  isolatedStateReason: string | null;
};

export type TopologyRelationshipAudit = {
  zeroDegreeModules: string[];
  missingSourceNodeIds: string[];
  missingTargetNodeIds: string[];
  duplicateRelationshipKeys: string[];
  selfReferencingRelationshipIds: string[];
  edgesRemovedByFilter: string[];
  edgesAbsentFromRenderedGraph: string[];
};

export type ConnectionFilter = "ALL" | "CONNECTED" | "UNCONNECTED" | "DISCOVERY_PENDING";

const areaPattern = /^(area-|monitored-)/i;

export const countNodeRelationships = (
  nodeId: string,
  edges: TopologyEdge[]
): { incoming: number; outgoing: number; total: number } => {
  let incoming = 0;
  let outgoing = 0;
  for (const edge of edges) {
    if (edge.sourceId === nodeId) outgoing += 1;
    if (edge.targetId === nodeId) incoming += 1;
  }
  return { incoming, outgoing, total: incoming + outgoing };
};

export const resolveConnectionState = (input: {
  node: TopologyNode;
  totalRelationships: number;
  monitoringState?: string | null;
}): { state: RelationshipConnectionState; reason: string | null } => {
  if (input.totalRelationships > 0 || input.node.parentId) {
    return { state: "connected", reason: null };
  }

  const awaiting =
    input.monitoringState === "AWAITING_FIRST_CHECK" ||
    areaPattern.test(input.node.id) ||
    /portal|website|system|centre|center/i.test(input.node.name);

  if (awaiting) {
    return {
      state: "discovery_incomplete",
      reason: "Relationship discovery pending — OpsWatch has not mapped dependencies for this module yet."
    };
  }

  return {
    state: "intentionally_isolated",
    reason: "No mapped dependencies — this module has no declared, discovered or learned relationships."
  };
};

export const buildNodeRelationshipDiagnostics = (
  topology: ProjectTopologyResponse,
  generatedAt: string | null = topology.generatedAt
): NodeRelationshipDiagnostic[] =>
  topology.nodes.map((node) => {
    const counts = countNodeRelationships(node.id, topology.edges);
    const monitoringState = topology.nodeContext?.[node.id]?.monitoringState ?? null;
    const resolved = resolveConnectionState({
      node,
      totalRelationships: counts.total,
      monitoringState
    });
    const discoverySource = areaPattern.test(node.id)
      ? "monitored-area"
      : counts.total > 0
        ? "declared"
        : "unknown";

    return {
      moduleId: node.id,
      moduleName: node.name,
      nodeType: node.type,
      visualLayer: classifyVisualLayer(node),
      incomingRelationshipCount: counts.incoming,
      outgoingRelationshipCount: counts.outgoing,
      totalRelationshipCount: counts.total,
      discoverySource,
      relationshipConfidence:
        counts.total > 0 ? "confirmed" : resolved.state === "discovery_incomplete" ? "insufficient" : "inferred",
      lastRelationshipDiscoveryTime: counts.total > 0 ? generatedAt : null,
      connectionState: resolved.state,
      isolatedStateReason: resolved.reason
    };
  });

export const summarizeRelationshipDiagnostics = (rows: NodeRelationshipDiagnostic[]) => {
  const modules = rows.filter((row) => row.nodeType === "MODULE" || row.visualLayer === "MODULE");
  return {
    totalModules: modules.length,
    connectedModules: modules.filter((row) => row.connectionState === "connected").length,
    unconnectedModules: modules.filter((row) => row.connectionState !== "connected").length,
    discoveryPendingModules: modules.filter((row) => row.connectionState === "discovery_incomplete").length,
    relationships: modules.reduce((sum, row) => sum + row.totalRelationshipCount, 0)
  };
};

export const matchesConnectionFilter = (
  state: RelationshipConnectionState,
  filter: ConnectionFilter
): boolean => {
  if (filter === "ALL") return true;
  if (filter === "CONNECTED") return state === "connected";
  if (filter === "UNCONNECTED") return state !== "connected";
  return state === "discovery_incomplete";
};

export const auditTopologyRelationships = (input: {
  topology: ProjectTopologyResponse;
  renderedEdgeKeys: Set<string>;
  filteredOutEdgeIds?: string[];
}): TopologyRelationshipAudit => {
  const nodeIds = new Set(input.topology.nodes.map((row) => row.id));
  const diagnostics = buildNodeRelationshipDiagnostics(input.topology);
  const seenKeys = new Map<string, number>();
  const missingSourceNodeIds: string[] = [];
  const missingTargetNodeIds: string[] = [];
  const selfReferencingRelationshipIds: string[] = [];
  const edgesAbsentFromRenderedGraph: string[] = [];

  for (const edge of input.topology.edges) {
    const key = `${edge.type}:${edge.sourceId}->${edge.targetId}`;
    seenKeys.set(key, (seenKeys.get(key) ?? 0) + 1);
    if (!nodeIds.has(edge.sourceId)) missingSourceNodeIds.push(edge.sourceId);
    if (!nodeIds.has(edge.targetId)) missingTargetNodeIds.push(edge.targetId);
    if (edge.sourceId === edge.targetId) selfReferencingRelationshipIds.push(edge.id);

    const renderedKeyCandidates = [
      `${edge.sourceId}->${edge.targetId}`,
      `${edge.targetId}->${edge.sourceId}`,
      `${edge.id}:${edge.sourceId}:${edge.targetId}`
    ];
    const present = renderedKeyCandidates.some((candidate) => input.renderedEdgeKeys.has(candidate));
    if (!present) edgesAbsentFromRenderedGraph.push(edge.id);
  }

  const duplicateRelationshipKeys = [...seenKeys.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key);

  return {
    zeroDegreeModules: diagnostics
      .filter((row) => row.nodeType === "MODULE" && row.totalRelationshipCount === 0)
      .map((row) => row.moduleId),
    missingSourceNodeIds: [...new Set(missingSourceNodeIds)],
    missingTargetNodeIds: [...new Set(missingTargetNodeIds)],
    duplicateRelationshipKeys,
    selfReferencingRelationshipIds,
    edgesRemovedByFilter: input.filteredOutEdgeIds ?? [],
    edgesAbsentFromRenderedGraph
  };
};

/** Stable badge copy for isolated / incomplete modules. */
export const isolationBadgeLabel = (state: RelationshipConnectionState): string | null => {
  if (state === "discovery_incomplete") return "Discovery pending";
  if (state === "intentionally_isolated") return "No mapped dependencies";
  return null;
};
