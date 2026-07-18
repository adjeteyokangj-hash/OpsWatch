"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectTopologyResponse,
  TopologyEdge,
  TopologyHealthStatus,
  TopologyNodeType,
  TopologyOverlays
} from "./topology-types";
import { healthClassName, healthLabel } from "./topology-types";
import { computeLayeredLayout, edgePath, edgeStrokeWidth, layerExpansionKey, LAYOUT, nodeAnchor } from "./topology-layout";
import { TopologyMoreCard, TopologyNodeCard } from "./topology-node-card";
import {
  buildTraceFocusIds,
  countHierarchyChildren,
  getCollapsedDescendantIds
} from "./topology-focus";
import { resolveDependencyDisplayLinks, resolveHierarchyDisplayLinks } from "./topology-edge-resolve";
import { edgeTrafficWeight, replayNodeStatus } from "./topology-metrics";
import {
  classifyVisualLayer,
  moreLayerPlural,
  visualLayerCountLabel,
  visualLayerTitle,
  type VisualLayer
} from "./topology-visual-layers";
import {
  buildNodeRelationshipDiagnostics,
  isolationBadgeLabel,
  matchesConnectionFilter,
  type ConnectionFilter
} from "./topology-relationship";
import {
  HIERARCHY_EDGE_COLOR,
  dependencyEdgeColorClass,
  describeSelectedEdge,
  edgeTooltipLines,
  resolveEndpointDisplayName,
  type SelectedTopologyEdge
} from "./topology-edge-style";

type Props = {
  topology: ProjectTopologyResponse;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  selectedEdgeId?: string | null;
  onSelectEdge?: (edge: SelectedTopologyEdge | null) => void;
  /** Dependency edges currently remediating / verifying — amber pulse. */
  remediatingEdgeIds?: ReadonlySet<string>;
  typeFilter: TopologyNodeType | "ALL";
  healthFilter: TopologyHealthStatus | "ALL";
  onInteractingChange?: (interacting: boolean) => void;
  overlays?: TopologyOverlays;
  subgraphOnly?: boolean;
  showChangeEvents?: boolean;
  showCorrelatedIncidents?: boolean;
  dimUnrelated?: boolean;
  traceFocus?: boolean;
  replayMinutesAgo?: number;
  searchQuery?: string;
  fitToken?: number;
  connectionFilter?: ConnectionFilter;
  cardsExpanded?: "none" | "selected" | "all";
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
};

const NODE_WIDTH = LAYOUT.nodeWidth;
const NODE_HEIGHT = LAYOUT.nodeHeight;
const NODE_HEIGHT_COLLAPSED: number = 64;

const trafficTone = (status: TopologyHealthStatus): string => {
  if (status === "HEALTHY") return "healthy";
  if (status === "DEGRADED") return "degraded";
  if (status === "CRITICAL") return "critical";
  return "unknown";
};

const TRAFFIC_PACKET_DELAYS = [0, 1.1, 2.3];

const TrafficPackets = ({
  pathD,
  edgeKey,
  tone,
  critical = false,
  dimmed = false,
  live = true,
  fill
}: {
  pathD: string;
  edgeKey: string;
  tone: string;
  critical?: boolean;
  dimmed?: boolean;
  live?: boolean;
  fill?: string;
}) => {
  if (dimmed || !live) return null;

  return (
    <>
      {TRAFFIC_PACKET_DELAYS.map((delay, index) => (
        <circle
          key={`${edgeKey}-packet-${index}`}
          r={critical ? 3.5 : 2.8}
          fill={fill}
          className={`topology-traffic-packet topology-traffic-packet--${tone}`}
        >
          <animateMotion
            dur={`${2.2 + index * 0.35}s`}
            repeatCount="indefinite"
            begin={`${delay}s`}
            path={pathD}
          />
        </circle>
      ))}
    </>
  );
};

export const TopologyCanvas = ({
  topology,
  selectedNodeId,
  onSelectNode,
  selectedEdgeId = null,
  onSelectEdge,
  remediatingEdgeIds,
  typeFilter,
  healthFilter,
  onInteractingChange,
  overlays,
  subgraphOnly = false,
  showChangeEvents = true,
  showCorrelatedIncidents = true,
  dimUnrelated = false,
  traceFocus = true,
  replayMinutesAgo = 0,
  searchQuery = "",
  fitToken = 0,
  connectionFilter = "ALL",
  cardsExpanded = "selected",
  onExpandAll,
  onCollapseAll
}: Props) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [referenceScale, setReferenceScale] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set());
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const dragOrigin = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const overlayFocusIds = useMemo(() => {
    const ids = new Set<string>(overlays?.affectedNodeIds ?? []);
    for (const root of overlays?.rootCauses ?? []) ids.add(root.nodeId);
    for (const edge of overlays?.propagationEdges ?? []) {
      ids.add(edge.sourceId);
      ids.add(edge.targetId);
    }
    for (const id of overlays?.incidentNodeIds ?? []) ids.add(id);
    return ids;
  }, [overlays]);

  const traceFocusIds = useMemo(
    () => (traceFocus && selectedNodeId ? buildTraceFocusIds(selectedNodeId, topology) : new Set<string>()),
    [traceFocus, selectedNodeId, topology]
  );

  const focusNodeIds = overlayFocusIds.size > 0 ? overlayFocusIds : traceFocusIds;
  const shouldDim = dimUnrelated || (traceFocus && selectedNodeId != null && overlayFocusIds.size === 0);

  const hiddenDescendants = useMemo(
    () => getCollapsedDescendantIds(collapsedNodeIds, topology.edges),
    [collapsedNodeIds, topology.edges]
  );

  const baseNodes = useMemo(() => {
    let rows = topology.nodes.filter((node) => !hiddenDescendants.has(node.id));
    if (subgraphOnly && focusNodeIds.size > 0) {
      rows = rows.filter((node) => focusNodeIds.has(node.id));
    }
    return rows;
  }, [topology.nodes, hiddenDescendants, subgraphOnly, focusNodeIds]);

  const layoutNodes = useMemo(() => {
    const nonApp = baseNodes.filter((node) => classifyVisualLayer(node) !== "APP");
    const apps = topology.nodes.filter((node) => classifyVisualLayer(node) === "APP");
    return [...apps, ...nonApp];
  }, [baseNodes, topology.nodes]);

  const layoutKey = `${layoutNodes.map((row) => row.id).sort().join("|")}|${[...collapsedNodeIds].sort().join(",")}|${[...expandedLayers].sort().join(",")}|${containerWidth}x${containerHeight}`;

  const graphLayout = useMemo(() => {
    // Height-limited fit shrinks the map; widen the layout so lanes still fill the canvas.
    const natural = computeLayeredLayout(layoutNodes, expandedLayers, LAYOUT.minCanvasWidth);
    let layoutMinWidth = LAYOUT.minCanvasWidth;
    if (containerWidth > 0) {
      const availableWidth = Math.max(
        120,
        containerWidth - LAYOUT.chromeSide * 2 - LAYOUT.fitPadding
      );
      const availableHeight = Math.max(
        120,
        (containerHeight || 720) - LAYOUT.chromeTop - LAYOUT.chromeBottom - LAYOUT.fitPadding
      );
      const heightScale = Math.min(1.2, availableHeight / Math.max(1, natural.height));
      const widthToFill = heightScale > 0 ? availableWidth / Math.max(heightScale, 0.35) : availableWidth;
      layoutMinWidth = Math.max(LAYOUT.minCanvasWidth, Math.ceil(widthToFill));
    }

    const base = computeLayeredLayout(layoutNodes, expandedLayers, layoutMinWidth);
    const positions = new Map(base.positions);

    if (showCorrelatedIncidents && overlays?.correlatedIncidents?.length) {
      overlays.correlatedIncidents.forEach((row, index) => {
        positions.set(`corr:${row.incidentId}`, { x: base.width - 120, y: 120 + index * 90 });
      });
    }
    if (showChangeEvents) {
      overlays?.changeEvents?.forEach((row, index) => {
        const anchor = row.serviceId ? positions.get(row.serviceId) : null;
        positions.set(`change:${row.id}`, {
          x: (anchor?.x ?? 180) + 170,
          y: (anchor?.y ?? 120 + index * 70) + 36
        });
      });
    }

    return { ...base, positions };
  }, [
    layoutNodes,
    overlays,
    showChangeEvents,
    showCorrelatedIncidents,
    expandedLayers,
    containerWidth,
    containerHeight
  ]);

  const nodeById = useMemo(() => new Map(topology.nodes.map((row) => [row.id, row])), [topology.nodes]);

  const layoutVisibleIds = graphLayout.visibleNodeIds;

  const zoomPercent = Math.max(25, Math.min(300, Math.round((viewport.scale / referenceScale) * 100)));

  const displayStatusFor = useCallback(
    (nodeId: string, status: TopologyHealthStatus): TopologyHealthStatus => {
      const node = topology.nodes.find((row) => row.id === nodeId);
      if (!node) return status;
      return replayNodeStatus(node, replayMinutesAgo);
    },
    [topology.nodes, replayMinutesAgo]
  );

  const relationshipByNode = useMemo(() => {
    const map = new Map(
      buildNodeRelationshipDiagnostics(topology).map((row) => [row.moduleId, row])
    );
    return map;
  }, [topology]);

  const edgeDescribeOptions = useMemo(() => {
    const endpointNotesById = new Map<string, string>();
    for (const [nodeId, relationship] of relationshipByNode) {
      if (relationship.connectionState === "discovery_incomplete") {
        endpointNotesById.set(
          nodeId,
          relationship.isolatedStateReason ??
            "Discovery pending — OpsWatch has not mapped dependencies for this node yet."
        );
      } else if (relationship.connectionState === "intentionally_isolated") {
        endpointNotesById.set(
          nodeId,
          relationship.isolatedStateReason ?? "No mapped dependencies."
        );
      }
    }
    return {
      moreNodes: graphLayout.moreNodes,
      endpointNotesById
    };
  }, [relationshipByNode, graphLayout.moreNodes]);

  const visibleNodes = useMemo(
    () =>
      baseNodes.filter((node) => {
        const status = displayStatusFor(node.id, node.status);
        if (typeFilter !== "ALL" && node.type !== typeFilter) return false;
        if (healthFilter !== "ALL" && status !== healthFilter) return false;
        if (searchQuery.trim()) {
          const query = searchQuery.trim().toLowerCase();
          if (!node.name.toLowerCase().includes(query) && !node.type.toLowerCase().includes(query)) {
            return false;
          }
        }
        if (!layoutVisibleIds.has(node.id)) return false;
        const relationship = relationshipByNode.get(node.id);
        if (
          relationship &&
          !matchesConnectionFilter(relationship.connectionState, connectionFilter)
        ) {
          return false;
        }
        return true;
      }),
    [
      baseNodes,
      typeFilter,
      healthFilter,
      searchQuery,
      displayStatusFor,
      layoutVisibleIds,
      relationshipByNode,
      connectionFilter
    ]
  );

  const hierarchyLinks = useMemo(
    () => resolveHierarchyDisplayLinks(topology.edges, topology.nodes, graphLayout),
    [topology.edges, topology.nodes, graphLayout]
  );

  const dependencyLinks = useMemo(
    () => resolveDependencyDisplayLinks(topology.edges, graphLayout),
    [topology.edges, graphLayout]
  );

  const rootCauseByNode = new Map((overlays?.rootCauses ?? []).map((row) => [row.nodeId, row]));

  useEffect(() => {
    onInteractingChange?.(dragging);
  }, [dragging, onInteractingChange]);

  const fitToScreen = useCallback(() => {
    const container = containerRef.current;
    if (!container || layoutNodes.length === 0) return;
    const bounds = [...graphLayout.positions.entries()]
      .filter(([id]) => graphLayout.visibleNodeIds.has(id) || id.startsWith("more:"))
      .map(([, position]) => position);
    if (bounds.length === 0) return;
    // Fit the full lane canvas (not just the node cluster) so bands fill the wrap.
    const minX = 0;
    const maxX = Math.max(
      graphLayout.width,
      Math.max(...bounds.map((row) => row.x)) + NODE_WIDTH / 2 + LAYOUT.paddingX / 2
    );
    const minY = Math.min(0, Math.min(...bounds.map((row) => row.y)) - NODE_HEIGHT / 2);
    const maxY = Math.max(
      graphLayout.height,
      Math.max(...bounds.map((row) => row.y)) + NODE_HEIGHT / 2 + LAYOUT.paddingY / 2
    );
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const availableWidth = Math.max(
      120,
      container.clientWidth - LAYOUT.chromeSide * 2 - LAYOUT.fitPadding
    );
    const availableHeight = Math.max(
      120,
      container.clientHeight - LAYOUT.chromeTop - LAYOUT.chromeBottom - LAYOUT.fitPadding
    );
    const scale = Math.min(availableWidth / width, availableHeight / height, 1.25);
    const nextScale = Math.max(scale, 0.35);
    setReferenceScale(nextScale);
    setViewport({
      scale: nextScale,
      x: (availableWidth - width * nextScale) / 2 - minX * nextScale + LAYOUT.chromeSide + LAYOUT.fitPadding / 2,
      y: (availableHeight - height * nextScale) / 2 - minY * nextScale + LAYOUT.chromeTop + LAYOUT.fitPadding / 2
    });
  }, [
    layoutNodes.length,
    graphLayout.positions,
    graphLayout.visibleNodeIds,
    graphLayout.width,
    graphLayout.height
  ]);

  useEffect(() => {
    fitToScreen();
  }, [layoutKey, subgraphOnly, fitToken, fitToScreen]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const syncSize = (width: number, height: number) => {
      const nextW = Math.round(width);
      const nextH = Math.round(height);
      setContainerWidth((current) => (current === nextW ? current : nextW));
      setContainerHeight((current) => (current === nextH ? current : nextH));
    };

    syncSize(container.clientWidth, container.clientHeight);

    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const width = entry?.contentRect.width ?? container.clientWidth;
      const height = entry?.contentRect.height ?? container.clientHeight;
      syncSize(width, height);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        fitToScreen();
      });
    });

    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fitToScreen]);

  const zoomBy = (factor: number) => {
    const container = containerRef.current;
    if (!container) return;

    setViewport((current) => {
      const minScale = Math.max(0.25, referenceScale * 0.25);
      const maxScale = Math.max(minScale, referenceScale * 3);
      const nextScale = Math.max(minScale, Math.min(maxScale, current.scale * factor));
      const centerX = container.clientWidth / 2;
      const centerY = container.clientHeight / 2;
      const worldX = (centerX - current.x) / current.scale;
      const worldY = (centerY - current.y) / current.scale;

      return {
        scale: nextScale,
        x: centerX - worldX * nextScale,
        y: centerY - worldY * nextScale
      };
    });
    onInteractingChange?.(true);
    window.setTimeout(() => onInteractingChange?.(false), 800);
  };

  const toggleCollapse = (nodeId: string) => {
    setCollapsedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const toggleLayerExpand = (layer: VisualLayer) => {
    const key = layerExpansionKey(layer);
    setExpandedLayers((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const dragMoved = useRef(false);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // Nodes and edges own their own click selection — do not steal pointer capture for pan.
    if (
      target.closest(
        ".topology-node, .topology-aux-node, .topology-edge, .topology-canvas-footer, button, a, input, select, textarea"
      )
    ) {
      return;
    }

    dragMoved.current = false;
    dragOrigin.current = { x: event.clientX, y: event.clientY, vx: viewport.x, vy: viewport.y };
    setDragging(true);
    onInteractingChange?.(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const origin = dragOrigin.current;
    if (!origin) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      dragMoved.current = true;
    }
    setViewport((current) => ({
      ...current,
      x: origin.vx + dx,
      y: origin.vy + dy
    }));
  };

  const endDrag = (event?: React.PointerEvent<HTMLDivElement>) => {
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const wasDrag = dragMoved.current;
    dragOrigin.current = null;
    dragMoved.current = false;
    setDragging(false);
    onInteractingChange?.(false);

    // Empty-canvas click clears edge/node selection (after pan has ended without movement).
    if (event?.type === "pointerup" && !wasDrag) {
      const target = event.target as HTMLElement;
      if (
        !target.closest(
          ".topology-node, .topology-aux-node, .topology-edge, .topology-canvas-footer, button, a"
        )
      ) {
        onSelectEdge?.(null);
        onSelectNode(null);
      }
    }
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;

    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const delta = event.deltaY > 0 ? 0.92 : 1.08;
    setViewport((current) => {
      const nextScale = Math.max(0.45, Math.min(2.5, current.scale * delta));
      const centerX = container.clientWidth / 2;
      const centerY = container.clientHeight / 2;
      const worldX = (centerX - current.x) / current.scale;
      const worldY = (centerY - current.y) / current.scale;

      return {
        scale: nextScale,
        x: centerX - worldX * nextScale,
        y: centerY - worldY * nextScale
      };
    });
    onInteractingChange?.(true);
    window.setTimeout(() => onInteractingChange?.(false), 800);
  };

  if (topology.nodes.length === 0) {
    return (
      <div className="topology-empty panel">
        <h2>No topology yet</h2>
        <p>Add services and dependency relationships in Reliability settings to build the live map.</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`topology-canvas-wrap${dragging ? " is-dragging" : ""}${shouldDim && focusNodeIds.size > 0 ? " topology-canvas-wrap--focus" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onWheel={onWheel}
      title="Ctrl + scroll to zoom the map"
      data-testid="topology-canvas"
    >
      <div className="topology-canvas-overlay" data-testid="topology-canvas-overlay" aria-hidden="true" />

      <svg
        className="topology-canvas"
        role="img"
        aria-label="Project topology graph"
        width={graphLayout.width}
        height={graphLayout.height}
        data-testid="topology-graph-svg"
      >
        <defs>
          <marker id="topology-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
          </marker>
          <filter id="topology-edge-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`} data-testid="topology-graph-transform">
          <g className="topology-layer-bands" data-testid="topology-layer-bands">
          {graphLayout.layerBands.map((band) => (
            <rect
              key={`band-${band.layer}`}
              className={`topology-layer-band layer-${band.layer.toLowerCase()}`}
              x={LAYOUT.bandStartX}
              y={band.y}
              width={graphLayout.width - LAYOUT.bandStartX - 12}
              height={band.height}
              rx={14}
            />
          ))}
          </g>

          <g className="topology-layer-labels">
          {graphLayout.layerBands.map((band) => (
            <foreignObject
              key={`label-${band.layer}`}
              x={8}
              y={band.y}
              width={LAYOUT.labelGutter - 16}
              height={band.height}
              className="topology-layer-label-wrap"
            >
              <div className="topology-layer-label-box">
                <span className="topology-layer-label-title">{visualLayerTitle(band.layer)}</span>
                <span className="topology-layer-label-meta">{visualLayerCountLabel(band.layer, band.count)}</span>
              </div>
            </foreignObject>
          ))}
          </g>

          <g className="topology-edges" data-testid="topology-edges">
          {hierarchyLinks.map((link) => {
            const childPos = graphLayout.positions.get(link.childId);
            const parentPos = graphLayout.positions.get(link.parentId);
            if (!childPos || !parentPos) return null;

            const start = nodeAnchor(parentPos, "bottom", NODE_HEIGHT_COLLAPSED);
            const end = nodeAnchor(childPos, "top", NODE_HEIGHT_COLLAPSED);
            const pathD = edgePath(start, end, true);
            const edgeDimmed =
              shouldDim &&
              focusNodeIds.size > 0 &&
              (!focusNodeIds.has(link.childId) || !focusNodeIds.has(link.parentId));
            const apiEdge =
              topology.edges.find(
                (row) =>
                  row.type === "HIERARCHY" &&
                  ((row.sourceId === link.childId && row.targetId === link.parentId) ||
                    (row.sourceId === link.parentId && row.targetId === link.childId))
              ) ?? null;
            const selected =
              selectedEdgeId != null &&
              (selectedEdgeId === apiEdge?.id || selectedEdgeId === link.key);
            const hierarchyEdge: TopologyEdge =
              apiEdge ??
              ({
                id: link.key,
                sourceId: link.childId,
                targetId: link.parentId,
                type: "HIERARCHY" as const,
                critical: false,
                status: "UNKNOWN" as const
              } satisfies TopologyEdge);
            const selectedDesc = describeSelectedEdge(
              hierarchyEdge,
              nodeById,
              "hierarchy",
              edgeDescribeOptions
            );
            const parentLabel = resolveEndpointDisplayName(
              link.parentId,
              nodeById,
              edgeDescribeOptions.moreNodes
            );
            const childLabel = resolveEndpointDisplayName(
              link.childId,
              nodeById,
              edgeDescribeOptions.moreNodes
            );

            return (
              <g
                key={link.key}
                className={`topology-edge topology-edge-hierarchy${edgeDimmed ? " dimmed" : ""}${selected ? " selected" : ""}`}
                style={{ color: HIERARCHY_EDGE_COLOR }}
                data-testid={`topology-edge-${link.key}`}
                data-edge-kind="hierarchy"
                data-edge-id={apiEdge?.id ?? link.key}
                role="button"
                tabIndex={0}
                aria-label={`Hierarchy ${parentLabel} contains ${childLabel}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!onSelectEdge) return;
                  onSelectEdge(selectedDesc);
                  onSelectNode(null);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.currentTarget.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                }}
              >
                <path d={pathD} className="topology-edge-hit" />
                <path
                  d={pathD}
                  className="topology-edge-line topology-edge-line--hierarchy"
                  stroke={HIERARCHY_EDGE_COLOR}
                  strokeWidth={2.2}
                />
                <title>{edgeTooltipLines(selectedDesc)}</title>
              </g>
            );
          })}

          {dependencyLinks.map((link) => {
            const source = graphLayout.positions.get(link.sourceId);
            const target = graphLayout.positions.get(link.targetId);
            if (!source || !target) return null;

            // Paint from evidence-based edge.status (API), not source/target node colour alone.
            const edgeHealth =
              replayMinutesAgo === 0
                ? link.edge.status
                : displayStatusFor(link.edge.targetId, link.edge.status);
            const pathD = edgePath(
              nodeAnchor(source, "bottom", NODE_HEIGHT_COLLAPSED),
              nodeAnchor(target, "top", NODE_HEIGHT_COLLAPSED),
              true
            );
            const weight = edgeTrafficWeight(link.edge, topology.nodes);
            const edgeDimmed =
              shouldDim &&
              focusNodeIds.size > 0 &&
              (!focusNodeIds.has(link.sourceId) || !focusNodeIds.has(link.targetId));
            const selected = selectedEdgeId === link.edge.id || selectedEdgeId === link.key;
            const remediating = remediatingEdgeIds?.has(link.edge.id) ?? false;
            const selectedDesc = describeSelectedEdge(link.edge, nodeById, "dependency", edgeDescribeOptions);

            const selectDependency = (event: React.SyntheticEvent) => {
              event.stopPropagation();
              onSelectEdge?.(selectedDesc);
              onSelectNode(null);
            };

            return (
              <g
                key={link.key}
                className={`topology-edge topology-edge-dependency${edgeDimmed ? " dimmed" : ""}${selected ? " selected" : ""}${remediating ? " remediating" : ""}`}
                data-testid={`topology-edge-${link.edge.id}`}
                data-edge-kind="dependency"
                data-edge-health={edgeHealth}
                data-edge-remediating={remediating ? "true" : "false"}
                data-edge-id={link.edge.id}
                role="button"
                tabIndex={0}
                aria-label={`Relationship ${selectedDesc.sourceName} to ${selectedDesc.targetName}, ${remediating ? "remediating" : selectedDesc.writtenHealth}`}
                onClick={selectDependency}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectDependency(event);
                  }
                }}
              >
                <path d={pathD} className="topology-edge-hit" />
                <path
                  d={pathD}
                  className={`topology-edge-line topology-edge-line--dependency ${remediating ? "topology-health-remediating" : dependencyEdgeColorClass(edgeHealth)}${link.edge.critical ? " critical" : ""}`}
                  markerEnd="url(#topology-arrow)"
                  strokeWidth={edgeStrokeWidth(weight)}
                  opacity={0.92}
                />
                <TrafficPackets
                  pathD={pathD}
                  edgeKey={link.key}
                  tone={remediating ? "degraded" : trafficTone(edgeHealth)}
                  critical={link.edge.critical}
                  dimmed={edgeDimmed}
                  live={replayMinutesAgo === 0}
                />
                <title>{edgeTooltipLines(selectedDesc)}</title>
              </g>
            );
          })}

          {(overlays?.propagationEdges ?? []).map((edge) => {
            if (
              dependencyLinks.some(
                (row) =>
                  (row.edge.sourceId === edge.sourceId && row.edge.targetId === edge.targetId) ||
                  (row.edge.sourceId === edge.targetId && row.edge.targetId === edge.sourceId)
              )
            ) {
              return null;
            }
            const source = graphLayout.positions.get(edge.sourceId);
            const target = graphLayout.positions.get(edge.targetId);
            if (!source || !target) return null;
            const pathD = edgePath(source, target, true);
            return (
              <g key={`prop-${edge.order}`} className="topology-edge topology-propagation-edge">
                <path d={pathD} className="topology-edge-line propagation" markerEnd="url(#topology-arrow)" />
                <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 6} className="topology-propagation-order">
                  {edge.order}
                </text>
              </g>
            );
          })}
          </g>

          <g className="topology-nodes" data-testid="topology-nodes">
          {visibleNodes.map((node) => {
            const position = graphLayout.positions.get(node.id);
            if (!position) return null;
            const selected = selectedNodeId === node.id;
            const rootCause = rootCauseByNode.get(node.id);
            const displayStatus = displayStatusFor(node.id, node.status);
            const dimmed = shouldDim && focusNodeIds.size > 0 && !focusNodeIds.has(node.id);
            const childCount = countHierarchyChildren(node.id, topology.edges, topology.nodes);
            const relationship = relationshipByNode.get(node.id);
            const isolationLabel = relationship
              ? isolationBadgeLabel(relationship.connectionState)
              : null;
            const expanded =
              cardsExpanded === "all" ||
              (cardsExpanded === "selected" && selectedNodeId === node.id);
            const cardHeight = expanded ? NODE_HEIGHT : NODE_HEIGHT_COLLAPSED;
            const openAlerts = node.risk.openAlerts;

            return (
              <g
                key={node.id}
                className={`topology-node ${healthClassName(displayStatus)}${classifyVisualLayer(node) === "APP" ? " topology-node--app" : ""}${selected ? " selected" : ""}${overlays?.affectedNodeIds?.includes(node.id) ? " affected" : ""}${overlays?.incidentNodeIds?.includes(node.id) ? " incident-linked" : ""}${rootCause ? " root-cause" : ""}${dimmed ? " dimmed" : ""}${selected && traceFocus ? " trace-focus" : ""}${isolationLabel ? " topology-node--isolated" : ""}${expanded ? " is-expanded" : " is-collapsed"}`}
                transform={`translate(${position.x - NODE_WIDTH / 2} ${position.y - cardHeight / 2})`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectEdge?.(null);
                  onSelectNode(selected ? null : node.id);
                }}
                data-testid={`topology-node-${node.id}`}
                data-connection-state={relationship?.connectionState ?? "connected"}
                data-expanded={expanded ? "true" : "false"}
                data-root-cause-rank={rootCause?.rank}
                aria-label={`${node.name}, ${healthLabel(displayStatus)}`}
                role="button"
                tabIndex={0}
              >
                <rect width={NODE_WIDTH} height={cardHeight} rx={14} className="topology-node-surface" />
                <circle cx={NODE_WIDTH / 2} cy={4} r={3.5} className="topology-node-anchor topology-node-anchor--top" />
                <circle cx={NODE_WIDTH / 2} cy={cardHeight - 4} r={3.5} className="topology-node-anchor topology-node-anchor--bottom" />
                {rootCause ? (
                  <g className="topology-root-badge">
                    <rect x={NODE_WIDTH - 34} y={8} width={26} height={18} rx={9} />
                    <text x={NODE_WIDTH - 21} y={21}>
                      #{rootCause.rank}
                    </text>
                  </g>
                ) : null}
                <foreignObject x={0} y={0} width={NODE_WIDTH} height={cardHeight}>
                  <TopologyNodeCard
                    node={node}
                    displayStatus={displayStatus}
                    compact
                    collapsed={!expanded}
                    alertCount={openAlerts}
                    isolationLabel={isolationLabel}
                    childCount={childCount}
                    onToggleCollapse={() => toggleCollapse(node.id)}
                  />
                </foreignObject>
                <title>
                  {node.name} · {healthLabel(displayStatus)}
                  {relationship?.isolatedStateReason ? ` · ${relationship.isolatedStateReason}` : ""}
                </title>
              </g>
            );
          })}

          {graphLayout.moreNodes.map((more) => {
            const position = graphLayout.positions.get(more.id);
            if (!position) return null;
            return (
              <g
                key={more.id}
                className="topology-node topology-more-node"
                transform={`translate(${position.x - NODE_WIDTH / 2} ${position.y - NODE_HEIGHT_COLLAPSED / 2})`}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleLayerExpand(more.layer);
                }}
                data-testid={`topology-more-${more.layer}`}
                aria-label={`Expand ${more.hiddenCount} more ${moreLayerPlural(more.layer)}`}
                role="button"
                tabIndex={0}
              >
                <rect width={NODE_WIDTH} height={NODE_HEIGHT_COLLAPSED} rx={14} className="topology-node-surface topology-more-node-surface" />
                <foreignObject x={0} y={0} width={NODE_WIDTH} height={NODE_HEIGHT_COLLAPSED}>
                  <TopologyMoreCard count={more.hiddenCount} label={moreLayerPlural(more.layer)} />
                </foreignObject>
              </g>
            );
          })}
          </g>

          {showChangeEvents
            ? overlays?.changeEvents?.map((row) => {
                const position = graphLayout.positions.get(`change:${row.id}`);
                if (!position) return null;
                return (
                  <g
                    key={row.id}
                    className="topology-aux-node topology-change-node"
                    transform={`translate(${position.x - 70} ${position.y - 24})`}
                    data-testid={`topology-change-${row.id}`}
                  >
                    <rect width={140} height={48} rx={10} />
                    <text x={10} y={16} className="topology-node-type">
                      {row.type.replace("_", " ")}
                    </text>
                    <text x={10} y={34} className="topology-node-name">
                      {row.title.slice(0, 22)}
                    </text>
                  </g>
                );
              })
            : null}

          {showCorrelatedIncidents
            ? overlays?.correlatedIncidents?.map((row) => {
                const position = graphLayout.positions.get(`corr:${row.incidentId}`);
                if (!position) return null;
                return (
                  <g
                    key={row.incidentId}
                    className="topology-aux-node topology-correlated-node"
                    transform={`translate(${position.x - 84} ${position.y - 28})`}
                    data-testid={`topology-correlated-${row.incidentId}`}
                  >
                    <rect width={168} height={56} rx={10} />
                    <text x={10} y={16} className="topology-node-type">
                      {row.projectName}
                    </text>
                    <text x={10} y={34} className="topology-node-name">
                      {row.title.slice(0, 24)}
                    </text>
                    <text x={10} y={50} className="topology-node-status">
                      {row.severity}
                    </text>
                  </g>
                );
              })
            : null}
        </g>
      </svg>

      <div className="topology-canvas-footer" onPointerDown={(event) => event.stopPropagation()}>
        <div className="topology-legend-v2">
          <span><i className="dot healthy" /> Healthy</span>
          <span><i className="dot degraded" /> Degraded</span>
          <span><i className="dot critical" /> Failing</span>
          <span><i className="dot unknown" /> Unknown</span>
          <span><i className="line dependency" /> Dependency</span>
          <span><i className="line indirect" /> Hierarchy</span>
        </div>
        <div className="topology-canvas-footer-actions">
          {onExpandAll ? (
            <button type="button" className="secondary-button" onClick={onExpandAll} data-testid="topology-expand-all">
              Expand all
            </button>
          ) : null}
          {onCollapseAll ? (
            <button type="button" className="secondary-button" onClick={onCollapseAll} data-testid="topology-collapse-all">
              Collapse all
            </button>
          ) : null}
          <div className="topology-zoom-controls">
            <button type="button" className="secondary-button" onClick={() => zoomBy(0.88)} aria-label="Zoom out">
              −
            </button>
            <span className="topology-zoom-level">{zoomPercent}%</span>
            <button type="button" className="secondary-button" onClick={() => zoomBy(1.12)} aria-label="Zoom in">
              +
            </button>
            <button type="button" className="secondary-button" onClick={fitToScreen}>
              Fit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
