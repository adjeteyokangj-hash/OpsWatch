import { describe, expect, it } from "vitest";
import type { ProjectTopologyResponse } from "./topology-types";
import {
  buildFactualInsight,
  buildLiveOpsItems,
  countChecksWithoutTargetUrl
} from "./topology-live-ops-build";

const topology: ProjectTopologyResponse = {
  project: { id: "proj-1", name: "Noble Express", status: "DEGRADED" },
  generatedAt: "2026-07-14T12:00:00.000Z",
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
      risk: { openAlerts: 1, unresolvedIncidents: 0 }
    }
  ],
  edges: [],
  summary: {
    total: 1,
    healthy: 0,
    degraded: 0,
    critical: 1,
    unknown: 0,
    openAlerts: 2,
    openIncidents: 1
  },
  nodeContext: {
    redis: {
      monitoringState: "MONITORED",
      lastCheckAt: "2026-07-14T11:55:00.000Z",
      lastCheckStatus: "FAIL",
      sloStatus: null,
      openAlerts: [{ id: "a1", title: "Redis unreachable", severity: "CRITICAL", status: "OPEN" }],
      unresolvedIncidents: [],
      upstreamIds: [],
      downstreamIds: []
    }
  }
};

describe("topology live ops builders", () => {
  it("counts services with active checks and no target URL", () => {
    expect(
      countChecksWithoutTargetUrl({
        services: [
          { id: "s1", name: "API", baseUrl: null, Check: [{ isActive: true }] },
          { id: "s2", name: "Web", baseUrl: "https://example.com", Check: [{ isActive: true }] },
          { id: "s3", name: "Idle", baseUrl: null, Check: [{ isActive: false }] }
        ]
      })
    ).toBe(1);
  });

  it("builds factual insight from open alerts before heartbeat copy", () => {
    const insight = buildFactualInsight({
      topology,
      project: { heartbeats: [{ receivedAt: "2026-07-14T11:59:00.000Z" }] },
      nowMs: Date.parse("2026-07-14T12:00:00.000Z")
    });
    expect(insight).toBe("2 open alerts");
  });

  it("merges real alerts, heals, and checks chronologically without fake predictions", () => {
    const items = buildLiveOpsItems({
      topology,
      projectId: "proj-1",
      project: {
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
        heartbeats: [{ receivedAt: "2026-07-14T11:50:00.000Z" }]
      },
      remediationLogs: [
        {
          id: "h1",
          projectId: "proj-1",
          serviceId: "redis",
          action: "RERUN_HTTP_CHECK",
          status: "SUCCEEDED",
          executionMode: "AUTONOMOUS",
          createdAt: "2026-07-14T11:57:00.000Z",
          executedAt: "2026-07-14T11:57:00.000Z"
        }
      ],
      checkResults: {
        summary: { total: 1, pass: 0, fail: 1, warn: 0, pending: 0 },
        items: [
          {
            id: "c1",
            name: "Ping",
            isActive: true,
            service: { id: "redis", name: "Redis" },
            latestResult: {
              status: "FAIL",
              responseTimeMs: 1200,
              checkedAt: "2026-07-14T11:56:00.000Z"
            }
          }
        ]
      },
      nowMs: Date.parse("2026-07-14T12:00:00.000Z"),
      limit: 10
    });

    expect(items.some((row) => row.kind === "alert" && row.title === "Redis unreachable")).toBe(true);
    expect(items.some((row) => row.kind === "heal" && row.title.toLowerCase().includes("rerun"))).toBe(true);
    expect(items.some((row) => row.kind === "check" && row.detail.includes("1200 ms"))).toBe(true);
    expect(items.every((row) => !/%\s*prediction|saturation/i.test(`${row.title} ${row.detail}`))).toBe(true);
  });

  it("filters feed to selected node service when present", () => {
    const items = buildLiveOpsItems({
      topology,
      projectId: "proj-1",
      selectedNode: topology.nodes[0]!,
      project: {
        alerts: [
          {
            id: "a1",
            title: "Redis unreachable",
            severity: "CRITICAL",
            status: "OPEN",
            lastSeenAt: "2026-07-14T11:58:00.000Z",
            serviceId: "redis"
          },
          {
            id: "a2",
            title: "Other alert",
            severity: "LOW",
            status: "OPEN",
            lastSeenAt: "2026-07-14T11:59:00.000Z",
            serviceId: "other"
          }
        ]
      },
      nowMs: Date.parse("2026-07-14T12:00:00.000Z")
    });

    expect(items.some((row) => row.title === "Redis unreachable")).toBe(true);
    expect(items.some((row) => row.title === "Other alert")).toBe(false);
  });
});
