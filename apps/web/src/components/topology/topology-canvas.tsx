"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectTopologyResponse,
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
import type { VisualLayer } from "./topology-visual-layers";
import { classifyVisualLayer, layerEdgeColor, visualLayerCountLabel, visualLayerTitle } from "./topology-visual-layers";
import {
  buildNodeRelationshipDiagnostics,
  isolationBadgeLabel,
  matchesConnectionFilter,
  type ConnectionFilter
} from "./topology-relationship";

const moreLayerLabel = (layer: VisualLayer): string => {
  if (layer === "MODULE") return "modules";
  if (layer === "WORKFLOW") return "workflows";
  if (layer === "SERVICE") return "services";
  if (layer === "INFRASTRUCTURE") return "resources";
  if (layer === "EXTERNAL") return "services";
  return "nodes";
};

type Props = {
  topology: ProjectTopologyResponse;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
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
};

const NODE_WIDTH = LAYOUT.nodeWidth;
const NODE_HEIGHT = LAYOUT.nodeHeight;

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
  connectionFilter = "ALL"
}: Props) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [referenceScale, setReferenceScale] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set());
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

  const layoutKey = `${layoutNodes.map((row) => row.id).sort().join("|")}|${[...collapsedNodeIds].sort().join(",")}|${[...expandedLayers].sort().join(",")}`;

  const graphLayout = useMemo(() => {
    const base = computeLayeredLayout(layoutNodes, expandedLayers);
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
  }, [layoutNodes, overlays, showChangeEvents, showCorrelatedIncidents, expandedLayers]);

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
      buildNodeRelationshipDiagnostics(topology).map((row) => [row.moduleId, row] as const)
    );
    return map;
  }, [topology]);

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
    const minX = Math.min(...bounds.map((row) => row.x)) - NODE_WIDTH / 2;
    const maxX = Math.max(...bounds.map((row) => row.x)) + NODE_WIDTH / 2;
    const minY = Math.min(...bounds.map((row) => row.y)) - NODE_HEIGHT / 2;
    const maxY = Math.max(...bounds.map((row) => row.y)) + NODE_HEIGHT / 2;
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const availableWidth = Math.max(
      120,
      container.clientWidth - LAYOUT.chromeSide * 2 - LAYOUT.fitPadding * 2
    );
    const availableHeight = Math.max(
      120,
      container.clientHeight - LAYOUT.chromeTop - LAYOUT.chromeBottom - LAYOUT.fitPadding * 2
    );
    const scale = Math.min(availableWidth / width, availableHeight / height, 1.2);
    const nextScale = Math.max(scale, 0.35);
    setReferenceScale(nextScale);
    setViewport({
      scale: nextScale,
      x: (availableWidth - width * nextScale) / 2 - minX * nextScale + LAYOUT.chromeSide + LAYOUT.fitPadding,
      y: (availableHeight - height * nextScale) / 2 - minY * nextScale + LAYOUT.chromeTop + LAYOUT.fitPadding
    });
  }, [layoutNodes.length, graphLayout.positions, graphLayout.visibleNodeIds]);

  useEffect(() => {
    fitToScreen();
  }, [layoutKey, subgraphOnly, fitToken, fitToScreen]);

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

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(".topology-node, .topology-aux-node, .topology-canvas-footer, button, a")) return;

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
    dragOrigin.current = null;
    setDragging(false);
    onInteractingChange?.(false);
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

            const start = nodeAnchor(parentPos, "bottom");
            const end = nodeAnchor(childPos, "top");
            const pathD = edgePath(start, end, true);
            const edgeDimmed =
              shouldDim &&
              focusNodeIds.size > 0 &&
              (!focusNodeIds.has(link.childId) || !focusNodeIds.has(link.parentId));
            const layerColor = layerEdgeColor(link.parentLayer);

            return (
              <g
                key={link.key}
                className={`topology-edge topology-edge-hierarchy${edgeDimmed ? " dimmed" : ""}`}
                style={{ color: layerColor }}
              >
                <path
                  d={pathD}
                  className="topology-edge-line topology-edge-line--hierarchy"
                  stroke={layerColor}
                  strokeWidth={2.5}
                  filter="url(#topology-edge-glow)"
                />
                <TrafficPackets
                  pathD={pathD}
                  edgeKey={link.key}
                  tone="hierarchy-flow"
                  dimmed={edgeDimmed}
                  live={replayMinutesAgo === 0}
                  fill={layerColor}
                />
              </g>
            );
          })}

          {dependencyLinks.map((link) => {
            const source = graphLayout.positions.get(link.sourceId);
            const target = graphLayout.positions.get(link.targetId);
            if (!source || !target) return null;

            const replayStatus = displayStatusFor(link.edge.targetId, link.edge.status);
            const pathD = edgePath(nodeAnchor(source, "bottom"), nodeAnchor(target, "top"), true);
            const weight = edgeTrafficWeight(link.edge, topology.nodes);
            const edgeDimmed =
              shouldDim &&
              focusNodeIds.size > 0 &&
              (!focusNodeIds.has(link.sourceId) || !focusNodeIds.has(link.targetId));

            return (
              <g
                key={link.key}
                className={`topology-edge topology-edge-dependency${edgeDimmed ? " dimmed" : ""}`}
              >
                <path
                  d={pathD}
                  className={`topology-edge-line topology-edge-line--dependency ${healthClassName(replayStatus)}${link.edge.critical ? " critical" : ""}`}
                  markerEnd="url(#topology-arrow)"
                  strokeWidth={edgeStrokeWidth(weight)}
                  opacity={0.85}
                  filter="url(#topology-edge-glow)"
                />
                <TrafficPackets
                  pathD={pathD}
                  edgeKey={link.key}
                  tone={trafficTone(replayStatus)}
                  critical={link.edge.critical}
                  dimmed={edgeDimmed}
                  live={replayMinutesAgo === 0}
                />
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
            const collapsed = collapsedNodeIds.has(node.id);
            const relationship = relationshipByNode.get(node.id);
            const isolationLabel = relationship
              ? isolationBadgeLabel(relationship.connectionState)
              : null;

            return (
              <g
                key={node.id}
                className={`topology-node ${healthClassName(displayStatus)}${selected ? " selected" : ""}${overlays?.affectedNodeIds?.includes(node.id) ? " affected" : ""}${overlays?.incidentNodeIds?.includes(node.id) ? " incident-linked" : ""}${rootCause ? " root-cause" : ""}${dimmed ? " dimmed" : ""}${selected && traceFocus ? " trace-focus" : ""}${isolationLabel ? " topology-node--isolated" : ""}`}
                transform={`translate(${position.x - NODE_WIDTH / 2} ${position.y - NODE_HEIGHT / 2})`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectNode(node.id);
                }}
                data-testid={`topology-node-${node.id}`}
                data-connection-state={relationship?.connectionState ?? "connected"}
                data-root-cause-rank={rootCause?.rank}
                aria-label={`${node.name}, ${healthLabel(displayStatus)}`}
                role="button"
                tabIndex={0}
              >
                <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx={14} className="topology-node-surface" />
                <circle cx={NODE_WIDTH / 2} cy={4} r={3.5} className="topology-node-anchor topology-node-anchor--top" />
                <circle cx={NODE_WIDTH / 2} cy={NODE_HEIGHT - 4} r={3.5} className="topology-node-anchor topology-node-anchor--bottom" />
                {rootCause ? (
                  <g className="topology-root-badge">
                    <rect x={NODE_WIDTH - 34} y={8} width={26} height={18} rx={9} />
                    <text x={NODE_WIDTH - 21} y={21}>
                      #{rootCause.rank}
                    </text>
                  </g>
                ) : null}
                <foreignObject x={0} y={0} width={NODE_WIDTH} height={NODE_HEIGHT}>
                  <TopologyNodeCard
                    node={node}
                    displayStatus={displayStatus}
                    compact
                    childCount={childCount}
                    collapsed={collapsed}
                    isolationLabel={isolationLabel}
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
                transform={`translate(${position.x - NODE_WIDTH / 2} ${position.y - NODE_HEIGHT / 2})`}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleLayerExpand(more.layer);
                }}
                data-testid={`topology-more-${more.layer}`}
                aria-label={`Expand ${more.hiddenCount} more ${moreLayerLabel(more.layer)}`}
                role="button"
                tabIndex={0}
              >
                <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx={14} className="topology-node-surface topology-more-node-surface" />
                <foreignObject x={0} y={0} width={NODE_WIDTH} height={NODE_HEIGHT}>
                  <TopologyMoreCard count={more.hiddenCount} label={moreLayerLabel(more.layer)} />
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
          <span><i className="dot healthy" /> Healthy traffic</span>
          <span><i className="dot degraded" /> Slow traffic</span>
          <span><i className="dot critical" /> Failing traffic</span>
          <span><i className="dot unknown" /> Unknown</span>
          <span><i className="line dependency" /> Dependency</span>
          <span><i className="line indirect" /> Hierarchy</span>
        </div>
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
  );
};
