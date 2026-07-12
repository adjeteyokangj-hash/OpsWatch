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
    expect(screen.queryByTestId("topology-node-app")).not.toBeInTheDocument();
    expect(screen.getByTestId("topology-node-redis")).toBeInTheDocument();
    expect(screen.getByLabelText("Redis, Waiting for first heartbeat")).toBeInTheDocument();
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

    expect(screen.getByLabelText("Redis, Waiting for first heartbeat")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Noble Express/)).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByLabelText("Redis, Waiting for first heartbeat"));
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
});
