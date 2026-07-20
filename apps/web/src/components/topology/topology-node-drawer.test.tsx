import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopologyNodeDrawer } from "./topology-node-drawer";
import type { ProjectTopologyResponse } from "./topology-types";

const topology: ProjectTopologyResponse = {
  project: { id: "proj-1", name: "Noble Express", status: "DEGRADED" },
  generatedAt: new Date().toISOString(),
  nodes: [
    {
      id: "redis",
      name: "Redis",
      type: "COMPONENT",
      status: "UNKNOWN",
      parentId: null,
      metrics: { availabilityPercent: null, latencyMs: null, errorRatePercent: null, sloBurnRate: null, availabilityTrend: [] },
      risk: { openAlerts: 1, unresolvedIncidents: 0 }
    }
  ],
  edges: [],
  summary: {
    total: 1,
    healthy: 0,
    degraded: 0,
    critical: 0,
    unknown: 1,
    openAlerts: 1,
    openIncidents: 0
  },
  nodeContext: {
    redis: {
      monitoringState: "AWAITING_FIRST_CHECK",
      lastCheckAt: null,
      lastCheckStatus: null,
      sloStatus: null,
      openAlerts: [{ id: "alert-1", title: "Redis unreachable", severity: "CRITICAL", status: "OPEN" }],
      unresolvedIncidents: [],
      upstreamIds: [],
      downstreamIds: [],
      recoveryState: "RECOVERING"
    }
  }
};

describe("TopologyNodeDrawer", () => {
  afterEach(() => cleanup());

  it("shows unknown monitoring state and drill-down links", () => {
    render(
      <TopologyNodeDrawer
        topology={topology}
        node={topology.nodes[0]!}
        projectId="proj-1"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/Why health is unknown/i)).toBeInTheDocument();
    expect(screen.getByText(/no completed check or heartbeat/i)).toBeInTheDocument();
    expect(screen.getByText("Open alerts")).toBeInTheDocument();
    expect(screen.getByText("Recovering")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view checks/i })).toHaveAttribute(
      "href",
      "/checks?projectId=proj-1&serviceId=redis"
    );
    expect(screen.getByRole("link", { name: /view alerts/i })).toHaveAttribute(
      "href",
      "/alerts?projectId=proj-1&serviceId=redis"
    );
  });
});
