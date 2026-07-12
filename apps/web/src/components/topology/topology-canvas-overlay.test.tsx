import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopologyCanvas } from "./topology-canvas";
import type { ProjectTopologyResponse } from "./topology-types";

const topology: ProjectTopologyResponse = {
  project: { id: "proj-1", name: "Noble Express", status: "DEGRADED" },
  generatedAt: new Date().toISOString(),
  nodes: [
    {
      id: "redis",
      name: "Redis",
      type: "COMPONENT",
      status: "CRITICAL",
      parentId: null,
      metrics: { availabilityPercent: null, latencyMs: null, errorRatePercent: null, sloBurnRate: null, availabilityTrend: [] },
      risk: { openAlerts: 1, unresolvedIncidents: 0 }
    },
    {
      id: "quote-api",
      name: "Quote API",
      type: "COMPONENT",
      status: "DEGRADED",
      parentId: null,
      metrics: { availabilityPercent: null, latencyMs: null, errorRatePercent: null, sloBurnRate: null, availabilityTrend: [] },
      risk: { openAlerts: 0, unresolvedIncidents: 1 }
    },
    {
      id: "app",
      name: "Noble Express",
      type: "APP",
      status: "HEALTHY",
      parentId: null,
      metrics: { availabilityPercent: null, latencyMs: null, errorRatePercent: null, sloBurnRate: null, availabilityTrend: [] },
      risk: { openAlerts: 0, unresolvedIncidents: 0 }
    }
  ],
  edges: [
    {
      id: "edge-1",
      sourceId: "quote-api",
      targetId: "redis",
      type: "DEPENDENCY",
      critical: true,
      status: "CRITICAL"
    }
  ],
  summary: {
    total: 3,
    healthy: 1,
    degraded: 1,
    critical: 1,
    unknown: 0,
    openAlerts: 1,
    openIncidents: 1
  },
  nodeContext: {}
};

describe("TopologyCanvas overlays", () => {
  afterEach(() => cleanup());

  it("highlights root cause rank on the node", () => {
    render(
      <TopologyCanvas
        topology={topology}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        typeFilter="ALL"
        healthFilter="ALL"
        overlays={{
          rootCauses: [
            {
              nodeId: "redis",
              rank: 1,
              confidence: 88,
              reason: "Upstream dependency failure",
              evidenceType: "INFERRED"
            }
          ],
          affectedNodeIds: ["redis", "quote-api"],
          propagationEdges: [
            {
              sourceId: "redis",
              targetId: "quote-api",
              order: 1,
              confidence: 88,
              evidence: ["Quote API depends on Redis"]
            }
          ]
        }}
      />
    );

    expect(screen.getByTestId("topology-node-redis")).toHaveAttribute("data-root-cause-rank", "1");
  });

  it("filters to affected subgraph only", () => {
    render(
      <TopologyCanvas
        topology={topology}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        typeFilter="ALL"
        healthFilter="ALL"
        subgraphOnly
        overlays={{ affectedNodeIds: ["redis", "quote-api"] }}
      />
    );

    expect(screen.getByTestId("topology-node-redis")).toBeInTheDocument();
    expect(screen.getByTestId("topology-node-quote-api")).toBeInTheDocument();
    expect(screen.queryByTestId("topology-node-app")).not.toBeInTheDocument();
  });

  it("renders correlated incident auxiliary nodes when enabled", () => {
    render(
      <TopologyCanvas
        topology={topology}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        typeFilter="ALL"
        healthFilter="ALL"
        showCorrelatedIncidents
        overlays={{
          correlatedIncidents: [
            {
              incidentId: "inc-2",
              projectId: "proj-2",
              projectName: "TrueNumeris",
              title: "Redis outage",
              severity: "HIGH",
              serviceIds: []
            }
          ]
        }}
      />
    );

    expect(screen.getByTestId("topology-correlated-inc-2")).toBeInTheDocument();
    expect(screen.getByText("TrueNumeris")).toBeInTheDocument();
  });

  it("keeps unknown health separate from risk counters", () => {
    const unknownTopology: ProjectTopologyResponse = {
      ...topology,
      nodes: [
        {
          id: "redis",
          name: "Redis",
          type: "COMPONENT",
          status: "UNKNOWN",
          parentId: null,
          metrics: { availabilityPercent: null, latencyMs: null, errorRatePercent: null, sloBurnRate: null, availabilityTrend: [] },
          risk: { openAlerts: 1, unresolvedIncidents: 1 }
        }
      ],
      edges: []
    };

    render(
      <TopologyCanvas
        topology={unknownTopology}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        typeFilter="ALL"
        healthFilter="ALL"
      />
    );

    expect(screen.getByLabelText("Redis, Waiting for first heartbeat")).toBeInTheDocument();
    expect(screen.queryByText(/Risk:/)).not.toBeInTheDocument();
  });
});
