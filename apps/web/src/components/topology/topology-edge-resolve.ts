import type { LayeredLayout, NodePosition } from "./topology-layout";
import type { TopologyEdge, TopologyNode } from "./topology-types";
import { classifyVisualLayer, type VisualLayer } from "./topology-visual-layers";

export type ResolvedHierarchyLink = {
  key: string;
  childId: string;
  parentId: string;
  parentLayer: VisualLayer;
};

const isHiddenAppNode = (node: TopologyNode | undefined): boolean =>
  Boolean(node && classifyVisualLayer(node) === "APP");

export const buildHiddenNodeToMoreMap = (layout: Pick<LayeredLayout, "moreNodes">): Map<string, string> => {
  const map = new Map<string, string>();
  for (const more of layout.moreNodes) {
    for (const hiddenId of more.hiddenIds) {
      map.set(hiddenId, more.id);
    }
  }
  return map;
};

export const resolvePlacedNodeId = (
  nodeId: string,
  positions: Map<string, NodePosition>,
  hiddenToMore: Map<string, string>
): string | null => {
  if (positions.has(nodeId)) return nodeId;
  const moreId = hiddenToMore.get(nodeId);
  return moreId && positions.has(moreId) ? moreId : null;
};

const parentLayerFor = (
  parentId: string,
  nodesById: Map<string, TopologyNode>,
  layout: Pick<LayeredLayout, "moreNodes">
): VisualLayer => {
  const more = layout.moreNodes.find((row) => row.id === parentId);
  if (more) return more.layer;
  const node = nodesById.get(parentId);
  return node ? classifyVisualLayer(node) : "MODULE";
};

export const resolveVisibleHierarchyParent = (
  parentId: string,
  nodesById: Map<string, TopologyNode>,
  parentByChild: Map<string, string>,
  positions: Map<string, NodePosition>,
  hiddenToMore: Map<string, string>
): string | null => {
  let current: string | undefined = parentId;
  const visited = new Set<string>();

  while (current && !visited.has(current)) {
    visited.add(current);

    const placedId = resolvePlacedNodeId(current, positions, hiddenToMore);
    if (placedId) return placedId;

    const node = nodesById.get(current);
    const nextParent: string | undefined = parentByChild.get(current) ?? node?.parentId ?? undefined;
    if (!nextParent) return null;

    if (isHiddenAppNode(nodesById.get(nextParent))) {
      current = parentByChild.get(nextParent) ?? nodesById.get(nextParent)?.parentId ?? undefined;
      continue;
    }

    current = nextParent;
  }

  return null;
};

export const resolveHierarchyDisplayLinks = (
  edges: TopologyEdge[],
  nodes: TopologyNode[],
  layout: LayeredLayout
): ResolvedHierarchyLink[] => {
  const nodesById = new Map(nodes.map((row) => [row.id, row]));
  const parentByChild = new Map<string, string>();
  for (const edge of edges) {
    if (edge.type === "HIERARCHY") parentByChild.set(edge.sourceId, edge.targetId);
  }
  const hiddenToMore = buildHiddenNodeToMoreMap(layout);
  const links = new Map<string, ResolvedHierarchyLink>();

  for (const edge of edges) {
    if (edge.type !== "HIERARCHY") continue;

    const childId = resolvePlacedNodeId(edge.sourceId, layout.positions, hiddenToMore);
    if (!childId) continue;

    const parentId = resolveVisibleHierarchyParent(
      edge.targetId,
      nodesById,
      parentByChild,
      layout.positions,
      hiddenToMore
    );
    if (!parentId || parentId === childId) continue;

    const key = `${childId}->${parentId}`;
    links.set(key, {
      key,
      childId,
      parentId,
      parentLayer: parentLayerFor(parentId, nodesById, layout)
    });
  }

  for (const node of nodes) {
    if (isHiddenAppNode(node) || !node.parentId) continue;

    const childId = resolvePlacedNodeId(node.id, layout.positions, hiddenToMore);
    if (!childId) continue;

    const parentId = resolveVisibleHierarchyParent(
      node.parentId,
      nodesById,
      parentByChild,
      layout.positions,
      hiddenToMore
    );
    if (!parentId || parentId === childId) continue;

    const key = `${childId}->${parentId}`;
    if (links.has(key)) continue;

    links.set(key, {
      key,
      childId,
      parentId,
      parentLayer: parentLayerFor(parentId, nodesById, layout)
    });
  }

  return [...links.values()];
};

export const resolveDependencyDisplayLinks = (
  edges: TopologyEdge[],
  layout: LayeredLayout
): Array<{ key: string; sourceId: string; targetId: string; edge: TopologyEdge }> => {
  const hiddenToMore = buildHiddenNodeToMoreMap(layout);
  const links = new Map<string, { key: string; sourceId: string; targetId: string; edge: TopologyEdge }>();

  for (const edge of edges) {
    if (edge.type !== "DEPENDENCY") continue;

    const sourceId = resolvePlacedNodeId(edge.sourceId, layout.positions, hiddenToMore);
    const targetId = resolvePlacedNodeId(edge.targetId, layout.positions, hiddenToMore);
    if (!sourceId || !targetId || sourceId === targetId) continue;

    const key = `${edge.id}:${sourceId}:${targetId}`;
    links.set(key, { key, sourceId, targetId, edge });
  }

  return [...links.values()];
};
