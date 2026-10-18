import type { TopologyNode } from "./topology-types";
import type { TopologyPresentationGroups } from "./topology-presentation-groups";
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
  fitPadding: 24,
  /** Gap between side-by-side property containers. */
  propertyGap: 24
} as const;

export type LayerBand = {
  /** Stable band identity for React keys (unique even when layers repeat). */
  bandKey: string;
  layer: VisualLayer;
  label: string;
  y: number;
  height: number;
  count: number;
  /** Optional horizontal placement for side-by-side property containers. */
  bandX?: number;
  bandWidth?: number;
  /** CSS class suffix override (e.g. property-a, shared). */
  toneClass?: string;
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

const rowWidth = (count: number, gapX: number = LAYOUT.gapX): number =>
  count * LAYOUT.nodeWidth + Math.max(0, count - 1) * gapX;

const usableBandWidth = (canvasWidth: number): number =>
  Math.max(LAYOUT.nodeWidth, canvasWidth - LAYOUT.paddingX * 2);

/** Prefer at least four cards per row; use more when the canvas is wide enough. */
export const nodesPerRowForWidth = (canvasWidth: number): number => {
  const usable = usableBandWidth(canvasWidth);
  const fit = Math.floor((usable + LAYOUT.gapX) / (LAYOUT.nodeWidth + LAYOUT.gapX));
  return Math.max(LAYOUT.nodesPerRow, fit);
};

/** Spread cards across the band when there is spare horizontal space. */
export const rowGapForWidth = (slotCount: number, canvasWidth: number): number => {
  if (slotCount <= 1) return LAYOUT.gapX;
  const usable = usableBandWidth(canvasWidth);
  const packed = rowWidth(slotCount, LAYOUT.gapX);
  if (packed >= usable) return LAYOUT.gapX;
  return (usable - slotCount * LAYOUT.nodeWidth) / (slotCount - 1);
};

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
  const perRow = nodesPerRowForWidth(maxCanvasWidth);
  const layerBands: LayerBand[] = [];
  let currentY = LAYOUT.paddingY + (appNodes.length > 0 ? LAYOUT.appHeaderHeight : 0);

  for (const { layer, nodes: layerNodes } of sortedLayers) {
    const expanded = expandedLayers.has(layerExpansionKey(layer));
    const collapsed = !expanded && layerNodes.length > LAYOUT.previewCount;
    const rows = collapsed
      ? [layerNodes.slice(0, LAYOUT.previewCount)]
      : Array.from({ length: Math.ceil(layerNodes.length / perRow) }, (_, row) =>
          layerNodes.slice(row * perRow, row * perRow + perRow)
        );

    for (const rowNodes of rows) {
      const slotCount = collapsed ? rowNodes.length + 1 : rowNodes.length;
      maxCanvasWidth = Math.max(maxCanvasWidth, rowWidth(slotCount) + LAYOUT.paddingX * 2);
    }

    const bandHeight = rows.length * LAYOUT.rowHeight + 20;
    layerBands.push({
      bandKey: `layer:${layer}`,
      layer,
      label: visualLayerLabel(layer, layerNodes.length),
      y: currentY - 24,
      height: bandHeight,
      count: layerNodes.length,
      toneClass: layer.toLowerCase()
    });

    rows.forEach((rowNodes, rowIndex) => {
      const collapsedRow = collapsed && rowIndex === 0;
      const slotCount = collapsedRow ? rowNodes.length + 1 : rowNodes.length;
      const gapX = rowGapForWidth(slotCount, maxCanvasWidth);
      const currentRowWidth = rowWidth(slotCount, gapX);
      const startX = LAYOUT.paddingX + (usableBandWidth(maxCanvasWidth) - currentRowWidth) / 2;

      rowNodes.forEach((node, col) => {
        visibleNodeIds.add(node.id);
        positions.set(node.id, {
          x: startX + col * (LAYOUT.nodeWidth + gapX) + LAYOUT.nodeWidth / 2,
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
          x: startX + rowNodes.length * (LAYOUT.nodeWidth + gapX) + LAYOUT.nodeWidth / 2,
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

/**
 * Orthogonal-leaning cubic path. Optional laneOffset spreads parallel edges
 * so dependency fans are readable without inventing new relationships.
 */
export const edgePath = (
  source: NodePosition,
  target: NodePosition,
  curved = true,
  laneOffset = 0
): string => {
  if (!curved) {
    return `M ${source.x} ${source.y} L ${target.x} ${target.y}`;
  }

  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const absDy = Math.max(24, Math.abs(dy));
  const curve = Math.max(36, Math.min(120, absDy * 0.42 + Math.abs(dx) * 0.08));
  const lateral = laneOffset * 22;
  const c1x = source.x + dx * 0.04 + lateral;
  const c1y = source.y + curve;
  const c2x = target.x - dx * 0.04 + lateral;
  const c2y = target.y - curve;

  return `M ${source.x} ${source.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${target.x} ${target.y}`;
};

/** Stable small integer lane for an edge key (−2…2). */
export const edgeLaneOffset = (edgeKey: string): number => {
  let hash = 0;
  for (let i = 0; i < edgeKey.length; i += 1) {
    hash = (hash * 31 + edgeKey.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 5) - 2;
};

const placeSectionNodes = (
  nodeIds: string[],
  nodesById: Map<string, TopologyNode>,
  positions: Map<string, NodePosition>,
  visibleNodeIds: Set<string>,
  originX: number,
  bandInnerWidth: number,
  startY: number,
  nodesPerRow: number
): number => {
  const nodes = nodeIds
    .map((id) => nodesById.get(id))
    .filter((node): node is TopologyNode => Boolean(node));
  if (nodes.length === 0) return LAYOUT.rowHeight + 20;

  const rows = Array.from({ length: Math.ceil(nodes.length / nodesPerRow) }, (_, row) =>
    nodes.slice(row * nodesPerRow, (row + 1) * nodesPerRow)
  );

  rows.forEach((rowNodes, rowIndex) => {
    const usable = Math.max(LAYOUT.nodeWidth, bandInnerWidth - 24);
    const packed =
      rowNodes.length * LAYOUT.nodeWidth + Math.max(0, rowNodes.length - 1) * LAYOUT.gapX;
    const localGap =
      rowNodes.length <= 1
        ? LAYOUT.gapX
        : packed >= usable
          ? LAYOUT.gapX
          : (usable - rowNodes.length * LAYOUT.nodeWidth) / (rowNodes.length - 1);
    const rowW =
      rowNodes.length * LAYOUT.nodeWidth + Math.max(0, rowNodes.length - 1) * localGap;
    const startX = originX + 12 + (usable - rowW) / 2;

    rowNodes.forEach((node, col) => {
      visibleNodeIds.add(node.id);
      positions.set(node.id, {
        x: startX + col * (LAYOUT.nodeWidth + localGap) + LAYOUT.nodeWidth / 2,
        y: startY + rowIndex * LAYOUT.rowHeight + LAYOUT.nodeHeight / 2
      });
    });
  });

  return rows.length * LAYOUT.rowHeight + 28;
};

/**
 * Property-aware presentation layout: guest-house containers side-by-side,
 * then shared / processes / access / infrastructure bands. Used only when
 * presentation groups are available; otherwise callers keep computeLayeredLayout.
 */
export const computePresentationLayout = (
  nodes: TopologyNode[],
  groups: TopologyPresentationGroups,
  minWidth: number = LAYOUT.minCanvasWidth
): LayeredLayout => {
  const positions = new Map<string, NodePosition>();
  const visibleNodeIds = new Set<string>();
  const layerBands: LayerBand[] = [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const appNodes = nodes
    .filter((node) => classifyVisualLayer(node) === "APP")
    .sort((a, b) => a.name.localeCompare(b.name));

  let maxCanvasWidth: number = Math.max(LAYOUT.minCanvasWidth, minWidth);
  let currentY = LAYOUT.paddingY + (appNodes.length > 0 ? LAYOUT.appHeaderHeight : 0);

  const propertySections = groups.sections.filter((section) => section.propertyNodeId);
  const otherSections = groups.sections.filter((section) => !section.propertyNodeId);
  /** In-band titles replace the left gutter used by the layer layout. */
  const bandStartX = 24;

  const sectionLabelPad = 36;

  if (propertySections.length > 0) {
    const contentWidth = maxCanvasWidth - bandStartX - 12;
    const gap = LAYOUT.propertyGap;
    const cellWidth =
      (contentWidth - gap * Math.max(0, propertySections.length - 1)) /
      Math.max(1, propertySections.length);
    const perRow = Math.max(2, Math.min(3, nodesPerRowForWidth(cellWidth + LAYOUT.paddingX)));

    let maxBandHeight = 0;
    propertySections.forEach((section, index) => {
      const bandX = bandStartX + index * (cellWidth + gap);
      const innerHeight =
        sectionLabelPad +
        placeSectionNodes(
          section.nodeIds,
          nodesById,
          positions,
          visibleNodeIds,
          bandX,
          cellWidth,
          currentY + sectionLabelPad,
          perRow
        );
      maxBandHeight = Math.max(maxBandHeight, innerHeight);
      layerBands.push({
        bandKey: section.id,
        layer: "MODULE",
        label: section.title,
        y: currentY - 8,
        height: Math.max(innerHeight, LAYOUT.rowHeight + sectionLabelPad),
        count: section.nodeIds.length,
        bandX,
        bandWidth: cellWidth,
        toneClass: section.tone
      });
    });

    // Normalize property band heights for a clean row.
    for (const band of layerBands) {
      if (band.bandKey.startsWith("property:")) {
        band.height = Math.max(maxBandHeight, LAYOUT.rowHeight + sectionLabelPad);
      }
    }
    currentY += Math.max(maxBandHeight, LAYOUT.rowHeight + sectionLabelPad) + LAYOUT.layerGap;
  }

  for (const section of otherSections) {
    const contentWidth = maxCanvasWidth - bandStartX - 12;
    const perRow = nodesPerRowForWidth(maxCanvasWidth);
    const bandHeight =
      sectionLabelPad +
      placeSectionNodes(
        section.nodeIds,
        nodesById,
        positions,
        visibleNodeIds,
        bandStartX,
        contentWidth,
        currentY + sectionLabelPad,
        perRow
      );
    const layerHint: VisualLayer =
      section.id === "processes"
        ? "WORKFLOW"
        : section.id === "infrastructure"
          ? "INFRASTRUCTURE"
          : section.id === "access"
            ? "COMPONENT"
            : "MODULE";
    layerBands.push({
      bandKey: section.id,
      layer: layerHint,
      label: section.title,
      y: currentY - 8,
      height: bandHeight,
      count: section.nodeIds.length,
      bandX: bandStartX,
      bandWidth: contentWidth,
      toneClass: section.tone
    });
    currentY += bandHeight + LAYOUT.layerGap;
  }

  // Ensure every provided node gets a position (filters may omit some).
  for (const node of nodes) {
    if (visibleNodeIds.has(node.id) || classifyVisualLayer(node) === "APP") continue;
    visibleNodeIds.add(node.id);
    if (!positions.has(node.id)) {
      positions.set(node.id, {
        x: maxCanvasWidth / 2,
        y: currentY + LAYOUT.nodeHeight / 2
      });
      currentY += LAYOUT.rowHeight;
    }
  }

  const firstBandY = layerBands[0]?.y ?? LAYOUT.paddingY;
  placeAppAnchors(positions, appNodes, maxCanvasWidth, firstBandY);
  for (const app of appNodes) visibleNodeIds.add(app.id);

  return {
    positions,
    width: maxCanvasWidth,
    height: Math.max(LAYOUT.minCanvasHeight, currentY + LAYOUT.paddingY),
    layerBands,
    moreNodes: [],
    visibleNodeIds
  };
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
