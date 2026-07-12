"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectTopologyResponse,
  TopologyHealthStatus,
  TopologyNodeType,
  TopologyOverlays
} from "./topology-types";
import { healthClassName, healthLabel } from "./topology-types";
import { computeLayeredLayout, edgePath, edgeStrokeWidth, LAYOUT } from "./topology-layout";
import { TopologyNodeCard } from "./topology-node-card";
import {
  buildTraceFocusIds,
  countHierarchyChildren,
  getCollapsedDescendantIds
} from "./topology-focus";
import { edgeTrafficWeight, replayNodeStatus } from "./topology-metrics";

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
};

const NODE_WIDTH = LAYOUT.nodeWidth;
const NODE_HEIGHT = LAYOUT.nodeHeight;

const trafficTone = (status: TopologyHealthStatus): string => {
  if (status === "HEALTHY") return "healthy";
  if (status === "DEGRADED") return "degraded";
  if (status === "CRITICAL") return "critical";
  return "unknown";
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
  fitToken = 0
}: Props) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [referenceScale, setReferenceScale] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());
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

  const layoutKey = `${baseNodes.map((row) => row.id).sort().join("|")}|${[...collapsedNodeIds].sort().join(",")}`;

  const graphLayout = useMemo(() => {
    const base = computeLayeredLayout(baseNodes);
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
  }, [baseNodes, layoutKey, overlays, showChangeEvents, showCorrelatedIncidents]);

  const zoomPercent = Math.max(25, Math.min(250, Math.round((viewport.scale / referenceScale) * 100)));

  const displayStatusFor = (nodeId: string, status: TopologyHealthStatus): TopologyHealthStatus => {
    const node = topology.nodes.find((row) => row.id === nodeId);
    if (!node) return status;
    return replayNodeStatus(node, replayMinutesAgo);
  };

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
        return true;
      }),
    [baseNodes, typeFilter, healthFilter, searchQuery, replayMinutesAgo]
  );

  const visibleNodeIds = new Set(visibleNodes.map((row) => row.id));
  const visibleEdges = topology.edges.filter((edge) => {
    if (!visibleNodeIds.has(edge.sourceId) || !visibleNodeIds.has(edge.targetId)) return false;
    if (subgraphOnly && focusNodeIds.size > 0) {
      return focusNodeIds.has(edge.sourceId) && focusNodeIds.has(edge.targetId);
    }
    return true;
  });

  const rootCauseByNode = new Map((overlays?.rootCauses ?? []).map((row) => [row.nodeId, row]));
  const propagationKeys = new Set(
    (overlays?.propagationEdges ?? []).map((row) => `${row.sourceId}->${row.targetId}`)
  );

  useEffect(() => {
    onInteractingChange?.(dragging);
  }, [dragging, onInteractingChange]);

  const fitToScreen = () => {
    const container = containerRef.current;
    if (!container || baseNodes.length === 0) return;
    const bounds = [...graphLayout.positions.values()];
    const minX = Math.min(...bounds.map((row) => row.x)) - NODE_WIDTH;
    const maxX = Math.max(...bounds.map((row) => row.x)) + NODE_WIDTH;
    const minY = Math.min(...bounds.map((row) => row.y)) - NODE_HEIGHT;
    const maxY = Math.max(...bounds.map((row) => row.y)) + NODE_HEIGHT;
    const width = maxX - minX;
    const height = maxY - minY;
    const scale = Math.min(container.clientWidth / width, container.clientHeight / height, 1.2);
    const nextScale = Math.max(scale, 0.45);
    setReferenceScale(nextScale);
    setViewport({
      scale: nextScale,
      x: container.clientWidth / 2 - ((minX + maxX) / 2) * nextScale,
      y: container.clientHeight / 2 - ((minY + maxY) / 2) * nextScale
    });
  };

  useEffect(() => {
    fitToScreen();
  }, [layoutKey, subgraphOnly, fitToken]);

  const zoomBy = (factor: number) => {
    const container = containerRef.current;
    if (!container) return;

    setViewport((current) => {
      const nextScale = Math.max(0.45, Math.min(2.5, current.scale * factor));
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
      <svg
        className="topology-canvas"
        role="img"
        aria-label="Project topology graph"
        width={graphLayout.width}
        height={graphLayout.height}
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

        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
          {graphLayout.layerBands.map((band) => (
            <text key={`label-${band.layer}`} x={36} y={band.y + 24} className="topology-layer-label">
              {band.layer}
            </text>
          ))}

          {graphLayout.layerBands.map((band) => (
            <rect
              key={`band-${band.layer}`}
              className={`topology-layer-band layer-${band.layer.toLowerCase()}`}
              x={24}
              y={band.y}
              width={graphLayout.width - 48}
              height={band.height}
              rx={16}
            />
          ))}

          {visibleEdges.map((edge) => {
            const source = graphLayout.positions.get(edge.sourceId);
            const target = graphLayout.positions.get(edge.targetId);
            if (!source || !target) return null;

            const replayStatus = displayStatusFor(edge.targetId, edge.status);
            const propagation = propagationKeys.has(`${edge.targetId}->${edge.sourceId}`)
              ? overlays?.propagationEdges?.find((row) => row.sourceId === edge.targetId && row.targetId === edge.sourceId)
              : propagationKeys.has(`${edge.sourceId}->${edge.targetId}`)
                ? overlays?.propagationEdges?.find((row) => row.sourceId === edge.sourceId && row.targetId === edge.targetId)
                : null;
            const pathId = `edge-path-${edge.id}`;
            const pathD = edgePath(source, target, true);
            const weight = edgeTrafficWeight(edge, topology.nodes);
            const edgeDimmed =
              shouldDim && focusNodeIds.size > 0 && (!focusNodeIds.has(edge.sourceId) || !focusNodeIds.has(edge.targetId));

            return (
              <g
                key={edge.id}
                className={`topology-edge topology-edge-${edge.type.toLowerCase()}${propagation ? " topology-propagation-edge" : ""}${edgeDimmed ? " dimmed" : ""}`}
              >
                <path
                  id={pathId}
                  d={pathD}
                  className={`topology-edge-line ${healthClassName(replayStatus)}${edge.critical ? " critical" : ""}${propagation ? " propagation" : ""}`}
                  markerEnd={edge.type === "DEPENDENCY" ? "url(#topology-arrow)" : undefined}
                  strokeWidth={edgeStrokeWidth(weight)}
                  filter="url(#topology-edge-glow)"
                />
                {!edgeDimmed && replayMinutesAgo === 0
                  ? [0, 1.1, 2.3].map((delay, index) => (
                      <circle
                        key={`${edge.id}-packet-${index}`}
                        r={edge.critical ? 3.5 : 2.8}
                        className={`topology-traffic-packet topology-traffic-packet--${trafficTone(replayStatus)}`}
                      >
                        <animateMotion dur={`${2.2 + index * 0.35}s`} repeatCount="indefinite" begin={`${delay}s`} path={pathD} />
                      </circle>
                    ))
                  : null}
                {propagation ? (
                  <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 6} className="topology-propagation-order">
                    {propagation.order}
                  </text>
                ) : null}
              </g>
            );
          })}

          {(overlays?.propagationEdges ?? []).map((edge) => {
            if (
              visibleEdges.some(
                (row) =>
                  (row.sourceId === edge.sourceId && row.targetId === edge.targetId) ||
                  (row.sourceId === edge.targetId && row.targetId === edge.sourceId)
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

          {visibleNodes.map((node) => {
            const position = graphLayout.positions.get(node.id);
            if (!position) return null;
            const selected = selectedNodeId === node.id;
            const rootCause = rootCauseByNode.get(node.id);
            const displayStatus = displayStatusFor(node.id, node.status);
            const dimmed = shouldDim && focusNodeIds.size > 0 && !focusNodeIds.has(node.id);
            const childCount = countHierarchyChildren(node.id, topology.edges, topology.nodes);
            const collapsed = collapsedNodeIds.has(node.id);

            return (
              <g
                key={node.id}
                className={`topology-node ${healthClassName(displayStatus)}${selected ? " selected" : ""}${overlays?.affectedNodeIds?.includes(node.id) ? " affected" : ""}${overlays?.incidentNodeIds?.includes(node.id) ? " incident-linked" : ""}${rootCause ? " root-cause" : ""}${dimmed ? " dimmed" : ""}${selected && traceFocus ? " trace-focus" : ""}`}
                transform={`translate(${position.x - NODE_WIDTH / 2} ${position.y - NODE_HEIGHT / 2})`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectNode(node.id);
                }}
                data-testid={`topology-node-${node.id}`}
                data-root-cause-rank={rootCause?.rank}
                aria-label={`${node.name}, ${healthLabel(displayStatus)}`}
                role="button"
                tabIndex={0}
              >
                <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx={14} className="topology-node-surface" />
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
                    childCount={childCount}
                    collapsed={collapsed}
                    onToggleCollapse={() => toggleCollapse(node.id)}
                  />
                </foreignObject>
                <title>
                  {node.name} · {healthLabel(displayStatus)}
                </title>
              </g>
            );
          })}

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
