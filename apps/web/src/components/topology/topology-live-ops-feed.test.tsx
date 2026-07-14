import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopologyLiveOpsFeed } from "./topology-live-ops-feed";
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
      metrics: {
        availabilityPercent: null,
        latencyMs: null,
        errorRatePercent: null,
        sloBurnRate: null,
        availabilityTrend: []
      },
      risk: { openAlerts: 1, unresolvedIncidents: 1 }
    }
  ],
  edges: [],
  summary: {
    total: 1,
    healthy: 0,
    degraded: 0,
    critical: 1,
    unknown: 0,
    openAlerts: 1,
    openIncidents: 1
  },
  nodeContext: {
    redis: {
      monitoringState: "MONITORED",
      lastCheckAt: "2026-07-14T11:55:00.000Z",
      lastCheckStatus: "FAIL",
      sloStatus: null,
      openAlerts: [{ id: "a1", title: "Redis unreachable", severity: "CRITICAL", status: "OPEN" }],
      unresolvedIncidents: [
        { id: "inc-1", title: "Redis outage", severity: "CRITICAL", status: "OPEN" }
      ],
      upstreamIds: [],
      downstreamIds: []
    }
  }
};

vi.mock("../../lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path === "/remediation/logs") {
      return [
        {
          id: "h1",
          projectId: "proj-1",
          serviceId: "redis",
          action: "RESTART_WORKER",
          status: "SUCCEEDED",
          executionMode: "AUTONOMOUS",
          createdAt: "2026-07-14T11:57:00.000Z",
          executedAt: "2026-07-14T11:57:00.000Z"
        }
      ];
    }
    if (path.startsWith("/checks?")) {
      return {
        summary: { total: 1, pass: 0, fail: 1, warn: 0, pending: 0 },
        items: []
      };
    }
    if (path.startsWith("/alerts?")) {
      return [
        {
          id: "a1",
          title: "Redis unreachable",
          severity: "CRITICAL",
          status: "OPEN",
          lastSeenAt: "2026-07-14T11:58:00.000Z",
          serviceId: "redis"
        }
      ];
    }
    if (path.startsWith("/projects/proj-1/change-events")) {
      return [
        {
          id: "ce1",
          eventType: "DEPLOY_RELEASE",
          summary: "Shipped 1.4.2",
          occurredAt: "2026-07-14T11:56:00.000Z",
          detailsJson: { version: "1.4.2" }
        }
      ];
    }
    if (path.startsWith("/projects/proj-1/service-dependencies")) {
      return [];
    }
    if (path.startsWith("/incidents?") || path === "/incidents/inc-1") {
      if (path === "/incidents/inc-1") {
        return { id: "inc-1", rootCause: "Redis memory pressure observed" };
      }
      return [
        {
          id: "inc-1",
          title: "Redis outage",
          severity: "CRITICAL",
          status: "OPEN",
          openedAt: "2026-07-14T11:40:00.000Z",
          serviceIds: ["redis"]
        }
      ];
    }
    throw new Error(`Unexpected path ${path}`);
  })
}));

describe("TopologyLiveOpsFeed", () => {
  afterEach(() => cleanup());

  it("renders operations timeline and honest learning progression", async () => {
    render(
      <TopologyLiveOpsFeed
        projectId="proj-1"
        topology={topology}
        project={{
          createdAt: "2026-07-12T00:00:00.000Z",
          alerts: [
            {
              id: "a1",
              title: "Redis unreachable",
              severity: "CRITICAL",
              status: "OPEN",
              lastSeenAt: "2026-07-14T11:58:00.000Z",
              serviceId: "redis"
            }
          ],
          heartbeats: [{ receivedAt: "2026-07-14T11:50:00.000Z", environment: "production" }]
        }}
        selectedNode={null}
        paused
      />
    );

    expect(screen.getByTestId("topology-live-ops-feed")).toBeInTheDocument();
    expect(screen.getByText("Operations Timeline")).toBeInTheDocument();
    expect(screen.getByTestId("topology-learning-progression")).toHaveTextContent(/Collecting signals|Learning dependencies/i);
    expect(screen.queryByTestId("topology-predictive-placeholder")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Redis unreachable")).toBeInTheDocument();
    });
    expect(screen.getByText(/Worker auto-restarted/i)).toBeInTheDocument();
    expect(screen.getByText(/Deployment detected/i)).toBeInTheDocument();
    expect(screen.queryByText(/%\s*prediction|saturation/i)).not.toBeInTheDocument();
  });

  it("shows stored RCA when a node with open incident is selected", async () => {
    render(
      <TopologyLiveOpsFeed
        projectId="proj-1"
        topology={topology}
        project={null}
        selectedNode={topology.nodes[0]!}
        paused
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/RCA: Redis memory pressure observed/i)).toBeInTheDocument();
    });
  });
});
