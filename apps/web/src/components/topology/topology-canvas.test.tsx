import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopologyCanvas } from "./topology-canvas";
import type { ProjectTopologyResponse } from "./topology-types";

const topology: ProjectTopologyResponse = {
  project: { id: "proj-1", name: "Noble Express", status: "DEGRADED" },
  generatedAt: new Date().toISOString(),
  nodes: [
    {
      id: "app",
      name: "Noble Express",
      type: "APP",
      status: "HEALTHY",
      parentId: null,
      metrics: { availabilityPercent: 99.9, latencyMs: 120, errorRatePercent: 0.1, sloBurnRate: 1, availabilityTrend: [100, 100, 100] },
      risk: { openAlerts: 0, unresolvedIncidents: 0 }
    },
    {
      id: "redis",
      name: "Redis",
      type: "COMPONENT",
      status: "UNKNOWN",
      parentId: null,
      metrics: { availabilityPercent: null, latencyMs: null, errorRatePercent: null, sloBurnRate: null, availabilityTrend: [] },
      risk: { openAlerts: 0, unresolvedIncidents: 0 }
    }
  ],
  edges: [
    {
      id: "edge-1",
      sourceId: "app",
      targetId: "redis",
      type: "DEPENDENCY",
      critical: true,
      status: "UNKNOWN"
    }
  ],
  summary: {
    total: 2,
    healthy: 1,
    degraded: 0,
    critical: 0,
    unknown: 1,
    openAlerts: 0,
    openIncidents: 0
  },
  nodeContext: {
    app: {
      monitoringState: "MONITORED",
      lastCheckAt: new Date().toISOString(),
      lastCheckStatus: "PASS",
      sloStatus: "HEALTHY",
      openAlerts: [],
      unresolvedIncidents: [],
      upstreamIds: [],
      downstreamIds: ["redis"]
    },
    redis: {
      monitoringState: "AWAITING_FIRST_CHECK",
      lastCheckAt: null,
      lastCheckStatus: null,
      sloStatus: null,
      openAlerts: [],
      unresolvedIncidents: [],
      upstreamIds: ["app"],
      downstreamIds: []
    }
  }
};

describe("TopologyCanvas", () => {
  afterEach(() => cleanup());

  it("renders returned nodes and unknown health label", () => {
    render(
      <TopologyCanvas
        topology={topology}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        typeFilter="ALL"
        healthFilter="ALL"
      />
    );

    expect(screen.getByTestId("topology-canvas")).toBeInTheDocument();
    // Application master card is painted above the lanes.
    expect(screen.getByTestId("topology-node-app")).toBeInTheDocument();
    expect(screen.getByTestId("topology-node-redis")).toBeInTheDocument();
    expect(screen.getByLabelText("Redis, Unknown")).toBeInTheDocument();
  });

  it("filters nodes by health state", () => {
    render(
      <TopologyCanvas
        topology={topology}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        typeFilter="ALL"
        healthFilter="UNKNOWN"
      />
    );

    expect(screen.getByTestId("topology-node-redis")).toBeInTheDocument();
    expect(screen.getByLabelText("Redis, Unknown")).toBeInTheDocument();
    expect(screen.queryByTestId("topology-node-app")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Noble Express, Healthy")).not.toBeInTheDocument();
  });

  it("selects a node when clicked", () => {
    const onSelectNode = vi.fn();
    render(
      <TopologyCanvas
        topology={topology}
        selectedNodeId={null}
        onSelectNode={onSelectNode}
        typeFilter="ALL"
        healthFilter="ALL"
      />
    );

    fireEvent.click(screen.getByLabelText("Redis, Unknown"));
    expect(onSelectNode).toHaveBeenCalledWith("redis");
  });

  it("shows empty setup state when no nodes exist", () => {
    render(
      <TopologyCanvas
        topology={{ ...topology, nodes: [], edges: [], summary: { ...topology.summary, total: 0 } }}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        typeFilter="ALL"
        healthFilter="ALL"
      />
    );

    expect(screen.getByText(/no topology yet/i)).toBeInTheDocument();
  });

  it("zooms in when + is clicked", () => {
    render(
      <TopologyCanvas
        topology={topology}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        typeFilter="ALL"
        healthFilter="ALL"
      />
    );

    const graph = document.querySelector(".topology-canvas > g");
    const before = graph?.getAttribute("transform");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const after = graph?.getAttribute("transform");
    expect(before).toBeTruthy();
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
  });

  it("does not render floating Group by / Layout controls inside the canvas", () => {
    render(
      <TopologyCanvas
        topology={topology}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        typeFilter="ALL"
        healthFilter="ALL"
      />
    );

    expect(screen.getByTestId("topology-canvas")).toBeInTheDocument();
    expect(document.querySelector(".topology-map-toolbar")).toBeNull();
    expect(screen.queryByLabelText("Group by")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Layout")).not.toBeInTheDocument();
    expect(screen.getByTestId("topology-graph-transform")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" }).closest(".topology-canvas-footer")).toBeTruthy();
  });

  it("keeps zoom controls outside the graph transform layer", () => {
    render(
      <TopologyCanvas
        topology={topology}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        typeFilter="ALL"
        healthFilter="ALL"
      />
    );

    const transform = screen.getByTestId("topology-graph-transform");
    expect(transform.contains(screen.getByRole("button", { name: "Zoom in" }))).toBe(false);
    expect(transform.contains(screen.getByRole("button", { name: "Fit" }))).toBe(false);
  });

  it("places edges above layer bands in SVG paint order", () => {
    render(
      <TopologyCanvas
        topology={topology}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        typeFilter="ALL"
        healthFilter="ALL"
      />
    );

    const bands = screen.getByTestId("topology-layer-bands");
    const edges = screen.getByTestId("topology-edges");
    expect(bands.compareDocumentPosition(edges) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("loads node cards collapsed by default and expands only the selected card", () => {
    const { rerender } = render(
      <TopologyCanvas
        topology={topology}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        typeFilter="ALL"
        healthFilter="ALL"
        cardsExpanded="selected"
      />
    );

    expect(screen.getByTestId("topology-node-redis")).toHaveAttribute("data-expanded", "false");

    rerender(
      <TopologyCanvas
        topology={topology}
        selectedNodeId="redis"
        onSelectNode={vi.fn()}
        typeFilter="ALL"
        healthFilter="ALL"
        cardsExpanded="selected"
      />
    );
    expect(screen.getByTestId("topology-node-redis")).toHaveAttribute("data-expanded", "true");
  });

  it("selects a dependency edge when clicked", () => {
    const onSelectEdge = vi.fn();
    render(
      <TopologyCanvas
        topology={topology}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        onSelectEdge={onSelectEdge}
        typeFilter="ALL"
        healthFilter="ALL"
      />
    );

    fireEvent.click(screen.getByTestId("topology-edge-edge-1"));
    expect(onSelectEdge).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "edge-1",
        kind: "dependency",
        sourceId: "app",
        targetId: "redis",
        writtenHealth: "Unknown"
      })
    );
  });

  it("does not start pan capture on edge pointerdown (so clicks can select)", () => {
    const onSelectEdge = vi.fn();
    render(
      <TopologyCanvas
        topology={topology}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        onSelectEdge={onSelectEdge}
        typeFilter="ALL"
        healthFilter="ALL"
      />
    );

    const canvas = screen.getByTestId("topology-canvas");
    const edge = screen.getByTestId("topology-edge-edge-1");
    fireEvent.pointerDown(edge, { pointerId: 1, clientX: 10, clientY: 10, bubbles: true });
    fireEvent.click(edge);
    expect(onSelectEdge).toHaveBeenCalled();
    expect(canvas.className).not.toMatch(/is-dragging/);
  });

  it("renders dependency health classes from edge.status", () => {
    const mixed: ProjectTopologyResponse = {
      ...topology,
      edges: [
        { id: "edge-healthy", sourceId: "app", targetId: "redis", type: "DEPENDENCY", critical: false, status: "HEALTHY" },
        { id: "edge-degraded", sourceId: "app", targetId: "redis", type: "DEPENDENCY", critical: false, status: "DEGRADED" },
        { id: "edge-critical", sourceId: "app", targetId: "redis", type: "DEPENDENCY", critical: true, status: "CRITICAL" }
      ]
    };

    const { rerender } = render(
      <TopologyCanvas
        topology={{ ...mixed, edges: [mixed.edges[0]] }}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        typeFilter="ALL"
        healthFilter="ALL"
      />
    );
    expect(screen.getByTestId("topology-edge-edge-healthy")).toHaveAttribute("data-edge-health", "HEALTHY");

    rerender(
      <TopologyCanvas
        topology={{ ...mixed, edges: [mixed.edges[1]] }}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        typeFilter="ALL"
        healthFilter="ALL"
      />
    );
    expect(screen.getByTestId("topology-edge-edge-degraded")).toHaveAttribute("data-edge-health", "DEGRADED");

    rerender(
      <TopologyCanvas
        topology={{ ...mixed, edges: [mixed.edges[2]] }}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        typeFilter="ALL"
        healthFilter="ALL"
      />
    );
    expect(screen.getByTestId("topology-edge-edge-critical")).toHaveAttribute("data-edge-health", "CRITICAL");
  });

  it("renders hierarchy edges with documented grey, not layer purple", () => {
    const hierarchyTopology: ProjectTopologyResponse = {
      ...topology,
      nodes: [
        ...topology.nodes,
        {
          id: "mod",
          name: "Orders",
          type: "MODULE",
          status: "HEALTHY",
          parentId: "app",
          metrics: {
            availabilityPercent: 99,
            latencyMs: 10,
            errorRatePercent: 0,
            sloBurnRate: 1,
            availabilityTrend: [99]
          },
          risk: { openAlerts: 0, unresolvedIncidents: 0 }
        }
      ],
      edges: [
        ...topology.edges,
        {
          id: "hier-1",
          sourceId: "mod",
          targetId: "app",
          type: "HIERARCHY",
          critical: false,
          status: "HEALTHY"
        }
      ],
      nodeContext: {
        ...topology.nodeContext,
        mod: {
          monitoringState: "MONITORED",
          lastCheckAt: new Date().toISOString(),
          lastCheckStatus: "PASS",
          sloStatus: "HEALTHY",
          openAlerts: [],
          unresolvedIncidents: [],
          upstreamIds: [],
          downstreamIds: []
        }
      }
    };

    render(
      <TopologyCanvas
        topology={hierarchyTopology}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        typeFilter="ALL"
        healthFilter="ALL"
      />
    );

    const hierarchyLine = document.querySelector(".topology-edge-line--hierarchy");
    expect(hierarchyLine).toBeTruthy();
    expect(hierarchyLine?.getAttribute("stroke")).toBe("#94a3b8");
  });
});
