import type { TopologyNode } from "./topology-types";
import {
  classifyVisualLayer,
  moreNodeId,
  VISUAL_LAYER_ORDER,
  type VisualLayer,
  visualLayerLabel
} from "./topology-visual-layers";

export type NodePosition = { x: number; y: number };

export const LAYOUT = {
  nodeWidth: 196,
  nodeHeight: 108,
  gapX: 18,
  rowHeight: 128,
  nodesPerRow: 4,
  previewCount: 3,
  paddingX: 148,
  paddingY: 72,
  layerGap: 28,
  minCanvasWidth: 1180,
  minCanvasHeight: 820
} as const;

export type LayerBand = {
  layer: VisualLayer;
  label: string;
  y: number;
  height: number;
  count: number;
};

export type MoreNode = {
  id: string;
  layer: VisualLayer;
  hiddenCount: number;
  hiddenIds: string[];
};

export type LayeredLayout = {
  positions: Map<string, NodePosition>;
  width: number;
  height: number;
  layerBands: LayerBand[];
  moreNodes: MoreNode[];
  visibleNodeIds: Set<string>;
};

const rowWidth = (count: number): number =>
  count * LAYOUT.nodeWidth + Math.max(0, count - 1) * LAYOUT.gapX;

export const layerExpansionKey = (layer: VisualLayer): string => `layer:${layer}`;

export const computeLayeredLayout = (
  nodes: TopologyNode[],
  expandedLayers: Set<string> = new Set()
): LayeredLayout => {
  const positions = new Map<string, NodePosition>();
  const moreNodes: MoreNode[] = [];
  const visibleNodeIds = new Set<string>();
  const grouped = new Map<VisualLayer, TopologyNode[]>();

  for (const layer of VISUAL_LAYER_ORDER) grouped.set(layer, []);
  for (const node of nodes) grouped.get(classifyVisualLayer(node))?.push(node);

  const sortedLayers = VISUAL_LAYER_ORDER.map((layer) => ({
    layer,
    nodes: [...(grouped.get(layer) ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  })).filter((entry) => entry.nodes.length > 0);

  let maxCanvasWidth: number = LAYOUT.minCanvasWidth;
  const layerBands: LayerBand[] = [];
  let currentY = LAYOUT.paddingY;

  for (const { layer, nodes: layerNodes } of sortedLayers) {
    const expanded = expandedLayers.has(layerExpansionKey(layer));
    const collapsed = !expanded && layerNodes.length > LAYOUT.previewCount;
    const rows = collapsed
      ? [layerNodes.slice(0, LAYOUT.previewCount)]
      : Array.from({ length: Math.ceil(layerNodes.length / LAYOUT.nodesPerRow) }, (_, row) =>
          layerNodes.slice(row * LAYOUT.nodesPerRow, row * LAYOUT.nodesPerRow + LAYOUT.nodesPerRow)
        );

    for (const rowNodes of rows) {
      const slotCount = collapsed ? rowNodes.length + 1 : rowNodes.length;
      maxCanvasWidth = Math.max(maxCanvasWidth, rowWidth(slotCount) + LAYOUT.paddingX * 2);
    }

    const bandHeight = rows.length * LAYOUT.rowHeight + 20;
    layerBands.push({
      layer,
      label: visualLayerLabel(layer, layerNodes.length),
      y: currentY - 24,
      height: bandHeight,
      count: layerNodes.length
    });

    rows.forEach((rowNodes, rowIndex) => {
      const collapsedRow = collapsed && rowIndex === 0;
      const slotCount = collapsedRow ? rowNodes.length + 1 : rowNodes.length;
      const currentRowWidth = rowWidth(slotCount);
      const startX = LAYOUT.paddingX + (maxCanvasWidth - LAYOUT.paddingX * 2 - currentRowWidth) / 2;

      rowNodes.forEach((node, col) => {
        visibleNodeIds.add(node.id);
        positions.set(node.id, {
          x: startX + col * (LAYOUT.nodeWidth + LAYOUT.gapX) + LAYOUT.nodeWidth / 2,
          y: currentY + rowIndex * LAYOUT.rowHeight + LAYOUT.nodeHeight / 2
        });
      });

      if (collapsedRow) {
        const hiddenIds = layerNodes.slice(LAYOUT.previewCount).map((row) => row.id);
        const moreId = moreNodeId(layer, 0);
        moreNodes.push({
          id: moreId,
          layer,
          hiddenCount: hiddenIds.length,
          hiddenIds
        });
        positions.set(moreId, {
          x: startX + rowNodes.length * (LAYOUT.nodeWidth + LAYOUT.gapX) + LAYOUT.nodeWidth / 2,
          y: currentY + rowIndex * LAYOUT.rowHeight + LAYOUT.nodeHeight / 2
        });
      }
    });

    currentY += bandHeight + LAYOUT.layerGap;
  }

  return {
    positions,
    width: maxCanvasWidth,
    height: Math.max(LAYOUT.minCanvasHeight, currentY + LAYOUT.paddingY),
    layerBands,
    moreNodes,
    visibleNodeIds
  };
};

export const edgePath = (
  source: NodePosition,
  target: NodePosition,
  curved = true
): string => {
  if (!curved) {
    return `M ${source.x} ${source.y} L ${target.x} ${target.y}`;
  }

  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const curve = Math.max(40, Math.min(140, Math.abs(dx) * 0.32 + Math.abs(dy) * 0.18));
  const c1x = source.x + dx * 0.06;
  const c1y = source.y + curve;
  const c2x = target.x - dx * 0.06;
  const c2y = target.y - curve;

  return `M ${source.x} ${source.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${target.x} ${target.y}`;
};

export const edgeStrokeWidth = (weight: number): number => {
  const normalized = Math.max(1.5, Math.min(6.5, 1.5 + weight / 4200));
  return Number(normalized.toFixed(1));
};
