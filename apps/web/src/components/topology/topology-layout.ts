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
  nodeWidth: 230,
  nodeHeight: 112,
  gapX: 28,
  /* Rows are sized for the default collapsed cards (64 world px); the selected
     expanded card intentionally overlays the band edge. Keeping the world
     compact keeps the fit scale near 1 so cards render at readable size. */
  rowHeight: 96,
  nodesPerRow: 4,
  previewCount: 3,
  labelGutter: 136,
  bandStartX: 140,
  paddingX: 160,
  paddingY: 40,
  layerGap: 20,
  minCanvasWidth: 1180,
  minCanvasHeight: 480,
  /** Reserved space above the first band for the painted application master card. */
  appHeaderHeight: 96,
  /** Fixed chrome inside the canvas wrap (legend + zoom) — not scaled by graph zoom. */
  chromeTop: 12,
  chromeBottom: 60,
  chromeSide: 16,
  fitPadding: 24
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

/**
 * Place APP master cards above the first band. These are painted (application
 * root card with the app name) and also anchor hierarchy/dependency edges.
 */
export const placeAppAnchors = (
  positions: Map<string, NodePosition>,
  appNodes: TopologyNode[],
  width: number,
  firstBandY: number
): void => {
  if (appNodes.length === 0) return;
  const y = Math.max(LAYOUT.paddingY * 0.9, firstBandY - 56);
  const spacing = LAYOUT.nodeWidth + 30;
  appNodes.forEach((app, index) => {
    const offset = (index - (appNodes.length - 1) / 2) * spacing;
    positions.set(app.id, {
      x: width / 2 + offset,
      y
    });
  });
};

export const computeLayeredLayout = (
  nodes: TopologyNode[],
  expandedLayers: Set<string> = new Set(),
  minWidth: number = LAYOUT.minCanvasWidth
): LayeredLayout => {
  const positions = new Map<string, NodePosition>();
  const moreNodes: MoreNode[] = [];
  const visibleNodeIds = new Set<string>();
  const grouped = new Map<VisualLayer, TopologyNode[]>();

  for (const layer of VISUAL_LAYER_ORDER) grouped.set(layer, []);
  for (const node of nodes) grouped.get(classifyVisualLayer(node))?.push(node);

  const appNodes = [...(grouped.get("APP") ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  const sortedLayers = VISUAL_LAYER_ORDER.map((layer) => ({
    layer,
    nodes: [...(grouped.get(layer) ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  }))
    .filter((entry) => entry.layer !== "APP")
    .filter((entry) => entry.nodes.length > 0);

  let maxCanvasWidth: number = Math.max(LAYOUT.minCanvasWidth, minWidth);
  const layerBands: LayerBand[] = [];
  let currentY = LAYOUT.paddingY + (appNodes.length > 0 ? LAYOUT.appHeaderHeight : 0);

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

  const firstBandY = layerBands[0]?.y ?? LAYOUT.paddingY;
  placeAppAnchors(positions, appNodes, maxCanvasWidth, firstBandY);
  for (const app of appNodes) visibleNodeIds.add(app.id);

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

export const nodeAnchor = (
  position: NodePosition,
  side: "top" | "bottom",
  nodeHeight: number = LAYOUT.nodeHeight
): NodePosition => ({
  x: position.x,
  y: position.y + (side === "top" ? -nodeHeight / 2 : nodeHeight / 2)
});
