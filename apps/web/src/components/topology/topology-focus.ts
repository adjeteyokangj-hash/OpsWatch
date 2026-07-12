import type { ProjectTopologyResponse, TopologyEdge, TopologyNode } from "./topology-types";

/** Hierarchy edges are stored child → parent (from = child, to = parent). */
const hierarchyChildren = (nodeId: string, edges: TopologyEdge[]): string[] =>
  edges.filter((edge) => edge.type === "HIERARCHY" && edge.targetId === nodeId).map((edge) => edge.sourceId);

const hierarchyParents = (nodeId: string, edges: TopologyEdge[]): string[] =>
  edges.filter((edge) => edge.type === "HIERARCHY" && edge.sourceId === nodeId).map((edge) => edge.targetId);

const walkDescendants = (nodeId: string, edges: TopologyEdge[]): Set<string> => {
  const seen = new Set<string>();
  const stack = [...hierarchyChildren(nodeId, edges)];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    stack.push(...hierarchyChildren(current, edges));
  }
  return seen;
};

const walkAncestors = (nodeId: string, edges: TopologyEdge[]): Set<string> => {
  const seen = new Set<string>();
  const stack = [...hierarchyParents(nodeId, edges)];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    stack.push(...hierarchyParents(current, edges));
  }
  return seen;
};

export const buildTraceFocusIds = (
  focusNodeId: string | null,
  topology: Pick<ProjectTopologyResponse, "nodes" | "edges" | "nodeContext">
): Set<string> => {
  if (!focusNodeId) return new Set<string>();

  const ids = new Set<string>([focusNodeId]);
  for (const id of walkAncestors(focusNodeId, topology.edges)) ids.add(id);
  for (const id of walkDescendants(focusNodeId, topology.edges)) ids.add(id);

  const context = topology.nodeContext[focusNodeId];
  for (const id of context?.upstreamIds ?? []) ids.add(id);
  for (const id of context?.downstreamIds ?? []) ids.add(id);

  for (const edge of topology.edges) {
    if (edge.type !== "DEPENDENCY") continue;
    if (ids.has(edge.sourceId)) ids.add(edge.targetId);
    if (ids.has(edge.targetId)) ids.add(edge.sourceId);
  }

  return ids;
};

export const getCollapsedDescendantIds = (
  collapsedNodeIds: Set<string>,
  edges: TopologyEdge[]
): Set<string> => {
  const hidden = new Set<string>();
  for (const nodeId of collapsedNodeIds) {
    for (const childId of walkDescendants(nodeId, edges)) hidden.add(childId);
  }
  return hidden;
};

export const countHierarchyChildren = (nodeId: string, edges: TopologyEdge[], nodes: TopologyNode[]): number => {
  const childIds = hierarchyChildren(nodeId, edges);
  return nodes.filter((row) => childIds.includes(row.id)).length;
};

export const hierarchyChildEdges = (edges: TopologyEdge[]): TopologyEdge[] =>
  edges.filter((edge) => edge.type === "HIERARCHY");
