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

/** Denser, larger-card metrics for property-aware presentation maps. */
export const PRESENTATION_LAYOUT = {
  nodeWidth: 210,
  nodeHeight: 76,
  gapX: 16,
  rowHeight: 112,
  sectionHeaderHeight: 40,
  propertyHeaderHeight: 56,
  bandPadX: 18,
  bandPadBottom: 18,
  propertyGap: 20,
  layerGap: 18,
  appHeaderHeight: 100,
  paddingY: 28,
  bandStartX: 104,
  nodesPerRowMin: 3,
  nodesPerRowMax: 6,
  minCanvasWidth: 1560
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
  /** Presentation header chrome. */
  headerSubtitle?: string;
  statusLabel?: string;
  statusTone?: "healthy" | "degraded" | "critical" | "unknown";
  isProperty?: boolean;
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
  // Prefer vertical routing for long drops so edges do not slash across bands.
  const verticalBias = Math.min(1, absDy / (Math.abs(dx) + absDy + 1));
  const curve = Math.max(28, Math.min(100, absDy * (0.35 + verticalBias * 0.2)));
  const lateral = laneOffset * (10 + (1 - verticalBias) * 10);
  const c1x = source.x + dx * (0.02 * (1 - verticalBias)) + lateral;
  const c1y = source.y + curve;
  const c2x = target.x - dx * (0.02 * (1 - verticalBias)) + lateral;
  const c2y = target.y - curve;

  return `M ${source.x} ${source.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${target.x} ${target.y}`;
};

/** Route presentation relationships through the space between card rows. */
export const presentationEdgePath = (source: NodePosition, target: NodePosition, lane = 0, bands: LayerBand[] = []): string => {
  const half = PRESENTATION_LAYOUT.nodeHeight / 2;
  const sameRow = Math.abs(source.y - target.y) < 1;
  const startY = source.y + half;
  const endY = target.y + (sameRow ? half : -half);
  const exitY = startY + 7 + (Math.abs(lane) % 6) * 3;
  if (sameRow) return `M ${source.x} ${startY} V ${exitY} H ${target.x} V ${endY}`;
  const sourceBand = bands.find(band => source.y >= band.y && source.y <= band.y + band.height);
  const targetBand = bands.find(band => target.y >= band.y && target.y <= band.y + band.height);
  if (sourceBand && sourceBand === targetBand && Math.abs(source.y - target.y) <= PRESENTATION_LAYOUT.rowHeight + 1) {
    const direction = target.y > source.y ? 1 : -1;
    const start = source.y + direction * half;
    const end = target.y - direction * half;
    const gutterY = (start + end) / 2 + (Math.abs(lane) % 7 - 3) * 2;
    return `M ${source.x} ${start} V ${gutterY} H ${target.x} V ${end}`;
  }
  if (!bands.length) {
    const midY = (startY + endY) / 2;
    return `M ${source.x} ${startY} V ${midY} H ${target.x} V ${endY}`;
  }
  // Cross-section runs stay outside headings; horizontal runs use card-row gutters.
  const railX = 12 + (Math.abs(lane) % 25) * 3;
  const entryY = endY - 8 - (Math.abs(lane) % 4) * 3;
  return `M ${source.x} ${startY} V ${exitY} H ${railX} V ${entryY} H ${target.x} V ${endY}`;
};

/** Stable small integer lane for an edge key (−2…2). */
export const edgeLaneOffset = (edgeKey: string): number => {
  let hash = 0;
  for (let i = 0; i < edgeKey.length; i += 1) {
    hash = (hash * 31 + edgeKey.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 5) - 2;
};

const statusToneOf = (
  status: TopologyNode["status"] | undefined
): "healthy" | "degraded" | "critical" | "unknown" => {
  if (status === "HEALTHY") return "healthy";
  if (status === "DEGRADED") return "degraded";
  if (status === "CRITICAL") return "critical";
  return "unknown";
};

const placePresentationNodes = (
  nodeIds: string[],
  nodesById: Map<string, TopologyNode>,
  positions: Map<string, NodePosition>,
  visibleNodeIds: Set<string>,
  originX: number,
  bandInnerWidth: number,
  startY: number,
  nodesPerRow: number
): number => {
  const P = PRESENTATION_LAYOUT;
  const nodes = nodeIds
    .map((id) => nodesById.get(id))
    .filter((node): node is TopologyNode => Boolean(node));
  if (nodes.length === 0) return P.rowHeight;

  const rowCount = Math.ceil(nodes.length / nodesPerRow);
  const balancedColumns = Math.ceil(nodes.length / rowCount);
  const rows = Array.from({ length: rowCount }, (_, row) =>
    nodes.slice(row * balancedColumns, (row + 1) * balancedColumns)
  );

  rows.forEach((rowNodes, rowIndex) => {
    const usable = Math.max(P.nodeWidth, bandInnerWidth - P.bandPadX * 2);
    const packed = rowNodes.length * P.nodeWidth + Math.max(0, rowNodes.length - 1) * P.gapX;
    const localGap =
      rowNodes.length <= 1
        ? P.gapX
        : packed >= usable
          ? P.gapX
          : (usable - rowNodes.length * P.nodeWidth) / (rowNodes.length - 1);
    const rowW = rowNodes.length * P.nodeWidth + Math.max(0, rowNodes.length - 1) * localGap;
    const startX = originX + P.bandPadX + (usable - rowW) / 2;

    rowNodes.forEach((node, col) => {
      visibleNodeIds.add(node.id);
      positions.set(node.id, {
        x: startX + col * (P.nodeWidth + localGap) + P.nodeWidth / 2,
        y: startY + rowIndex * P.rowHeight + P.nodeHeight / 2
      });
    });
  });

  return rows.length * P.rowHeight + P.bandPadBottom;
};

/**
 * Property-aware presentation layout: guest-house containers side-by-side,
 * then shared / processes / access / infrastructure bands. Used only when
 * presentation groups are available; otherwise callers keep computeLayeredLayout.
 */
export const computePresentationLayout = (
  nodes: TopologyNode[],
  groups: TopologyPresentationGroups,
  minWidth: number = PRESENTATION_LAYOUT.minCanvasWidth
): LayeredLayout => {
  const P = PRESENTATION_LAYOUT;
  const positions = new Map<string, NodePosition>();
  const visibleNodeIds = new Set<string>();
  const layerBands: LayerBand[] = [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const appNodes = nodes
    .filter((node) => classifyVisualLayer(node) === "APP")
    .sort((a, b) => a.name.localeCompare(b.name));

  let maxCanvasWidth: number = Math.max(P.minCanvasWidth, minWidth);
  let currentY = P.paddingY + (appNodes.length > 0 ? P.appHeaderHeight : 0);

  const propertySections = groups.sections.filter((section) => section.propertyNodeId);
  const otherSections = groups.sections.filter((section) => !section.propertyNodeId);
  const bandStartX = P.bandStartX;

  if (propertySections.length > 0) {
    const contentWidth = maxCanvasWidth - bandStartX - 12;
    const gap = P.propertyGap;
    const cellWidth =
      (contentWidth - gap * Math.max(0, propertySections.length - 1)) /
      Math.max(1, propertySections.length);
    const perRow = Math.max(
      1,
      Math.min(
        P.nodesPerRowMax,
        Math.floor((cellWidth - P.bandPadX * 2 + P.gapX) / (P.nodeWidth + P.gapX))
      )
    );

    let maxBandHeight = 0;
    propertySections.forEach((section, index) => {
      const bandX = bandStartX + index * (cellWidth + gap);
      const propertyNode = section.propertyNodeId
        ? nodesById.get(section.propertyNodeId)
        : undefined;
      const contentHeight = placePresentationNodes(
        section.nodeIds,
        nodesById,
        positions,
        visibleNodeIds,
        bandX,
        cellWidth,
        currentY + P.propertyHeaderHeight + 22,
        perRow
      );
      const bandHeight = P.propertyHeaderHeight + 22 + contentHeight;
      maxBandHeight = Math.max(maxBandHeight, bandHeight);
      layerBands.push({
        bandKey: section.id,
        layer: "MODULE",
        label: section.title,
        headerSubtitle: "Guest house",
        statusLabel:
          propertyNode?.status === "HEALTHY"
            ? "Online"
            : propertyNode?.status === "DEGRADED"
              ? "Degraded"
              : propertyNode?.status === "CRITICAL"
                ? "Critical"
                : "Unknown",
        statusTone: statusToneOf(propertyNode?.status),
        isProperty: true,
        y: currentY,
        height: bandHeight,
        count: section.nodeIds.length,
        bandX,
        bandWidth: cellWidth,
        toneClass: section.tone
      });
    });

    for (const band of layerBands) {
      if (band.isProperty) band.height = maxBandHeight;
    }
    currentY += maxBandHeight + P.layerGap;
  }

  for (const section of otherSections) {
    const contentWidth = maxCanvasWidth - bandStartX - 12;
    const perRow = Math.max(
      P.nodesPerRowMin,
      Math.min(
        P.nodesPerRowMax,
        Math.floor((contentWidth - P.bandPadX * 2 + P.gapX) / (P.nodeWidth + P.gapX))
      )
    );
    const contentHeight = placePresentationNodes(
      section.nodeIds,
      nodesById,
      positions,
      visibleNodeIds,
      bandStartX,
      contentWidth,
      currentY + P.sectionHeaderHeight + 22,
      perRow
    );
    const bandHeight = P.sectionHeaderHeight + 22 + contentHeight;
    const layerHint: VisualLayer =
      section.id === "processes"
        ? "WORKFLOW"
        : section.id === "infrastructure"
          ? "INFRASTRUCTURE"
          : section.id === "access"
            ? "SERVICE"
            : "MODULE";
    layerBands.push({
      bandKey: section.id,
      layer: layerHint,
      label: section.title,
      headerSubtitle: `${section.nodeIds.length} component${section.nodeIds.length === 1 ? "" : "s"}`,
      y: currentY,
      height: bandHeight,
      count: section.nodeIds.length,
      bandX: bandStartX,
      bandWidth: contentWidth,
      toneClass: section.tone
    });
    currentY += bandHeight + P.layerGap;
  }

  for (const node of nodes) {
    if (visibleNodeIds.has(node.id) || classifyVisualLayer(node) === "APP") continue;
    visibleNodeIds.add(node.id);
    if (!positions.has(node.id)) {
      positions.set(node.id, {
        x: maxCanvasWidth / 2,
        y: currentY + P.nodeHeight / 2
      });
      currentY += P.rowHeight;
    }
  }

  const firstBandY = layerBands[0]?.y ?? P.paddingY;
  placeAppAnchors(positions, appNodes, maxCanvasWidth, firstBandY);
  for (const app of appNodes) visibleNodeIds.add(app.id);

  return {
    positions,
    width: maxCanvasWidth,
    height: Math.max(LAYOUT.minCanvasHeight, currentY + P.paddingY),
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
