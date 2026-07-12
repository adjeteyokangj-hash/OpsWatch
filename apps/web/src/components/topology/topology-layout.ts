import type { TopologyNode, TopologyNodeType } from "./topology-types";
import { LAYER_ORDER } from "./topology-types";

export type NodePosition = { x: number; y: number };

export const LAYOUT = {
  nodeWidth: 168,
  nodeHeight: 82,
  gapX: 24,
  rowHeight: 108,
  nodesPerRow: 7,
  paddingX: 96,
  paddingY: 88,
  layerGap: 36,
  minCanvasWidth: 1040,
  minCanvasHeight: 760
} as const;

export type LayeredLayout = {
  positions: Map<string, NodePosition>;
  width: number;
  height: number;
  layerBands: Array<{ layer: TopologyNodeType; y: number; height: number }>;
};

const rowWidth = (count: number): number =>
  count * LAYOUT.nodeWidth + Math.max(0, count - 1) * LAYOUT.gapX;

export const computeLayeredLayout = (nodes: TopologyNode[]): LayeredLayout => {
  const positions = new Map<string, NodePosition>();
  const grouped = new Map<TopologyNodeType, TopologyNode[]>();

  for (const layer of LAYER_ORDER) grouped.set(layer, []);
  for (const node of nodes) grouped.get(node.type)?.push(node);

  const sortedLayers = LAYER_ORDER.map((layer) => ({
    layer,
    nodes: [...(grouped.get(layer) ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  })).filter((entry) => entry.nodes.length > 0);

  let maxCanvasWidth: number = LAYOUT.minCanvasWidth;
  for (const { nodes: layerNodes } of sortedLayers) {
    const rowCount = Math.ceil(layerNodes.length / LAYOUT.nodesPerRow);
    for (let row = 0; row < rowCount; row += 1) {
      const nodesInRow = Math.min(LAYOUT.nodesPerRow, layerNodes.length - row * LAYOUT.nodesPerRow);
      maxCanvasWidth = Math.max(maxCanvasWidth, rowWidth(nodesInRow) + LAYOUT.paddingX * 2);
    }
  }

  const layerBands: LayeredLayout["layerBands"] = [];
  let currentY = LAYOUT.paddingY;

  for (const { layer, nodes: layerNodes } of sortedLayers) {
    const rowCount = Math.ceil(layerNodes.length / LAYOUT.nodesPerRow);
    const bandHeight = rowCount * LAYOUT.rowHeight + 24;
    layerBands.push({ layer, y: currentY - 28, height: bandHeight });

    layerNodes.forEach((node, index) => {
      const row = Math.floor(index / LAYOUT.nodesPerRow);
      const col = index % LAYOUT.nodesPerRow;
      const nodesInRow = Math.min(LAYOUT.nodesPerRow, layerNodes.length - row * LAYOUT.nodesPerRow);
      const currentRowWidth = rowWidth(nodesInRow);
      const startX = LAYOUT.paddingX + (maxCanvasWidth - LAYOUT.paddingX * 2 - currentRowWidth) / 2;

      positions.set(node.id, {
        x: startX + col * (LAYOUT.nodeWidth + LAYOUT.gapX) + LAYOUT.nodeWidth / 2,
        y: currentY + row * LAYOUT.rowHeight + LAYOUT.nodeHeight / 2
      });
    });

    currentY += bandHeight + LAYOUT.layerGap;
  }

  return {
    positions,
    width: maxCanvasWidth,
    height: Math.max(LAYOUT.minCanvasHeight, currentY + LAYOUT.paddingY),
    layerBands
  };
};

export const edgePath = (
  source: NodePosition,
  target: NodePosition,
  curved = false
): string => {
  if (!curved) {
    return `M ${source.x} ${source.y} L ${target.x} ${target.y}`;
  }
  const midY = (source.y + target.y) / 2;
  return `M ${source.x} ${source.y} C ${source.x} ${midY}, ${target.x} ${midY}, ${target.x} ${target.y}`;
};
