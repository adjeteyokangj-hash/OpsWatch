import { describe, expect, it } from "vitest";
import type { ProjectTopologyResponse } from "./topology-types";
import {
  buildFactualInsight,
  buildLiveOpsItems,
  buildOpsInsights,
  countChecksWithoutTargetUrl,
  deriveLearningProgression
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

describe("topology operations timeline builders", () => {
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

  it("merges factual timeline kinds without inventing queue depth or baselines", () => {
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
        heartbeats: [
          {
            receivedAt: "2026-07-14T11:50:00.000Z",
            environment: "production",
            appVersion: "1.4.2",
            commitSha: "abc1234deadbeef"
          }
        ]
      },
      remediationLogs: [
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
      ],
      changeEvents: [
        {
          id: "ce1",
          eventType: "DEPLOY_RELEASE",
          summary: "Shipped release abc1234",
          occurredAt: "2026-07-14T11:56:30.000Z",
          detailsJson: { version: "1.4.2" }
        }
      ],
      dependencies: [
        {
          id: "d1",
          fromServiceId: "api",
          toServiceId: "redis",
          dependencyType: "RUNTIME",
          isActive: true,
          createdAt: "2026-07-14T10:00:00.000Z",
          FromService: { id: "api", name: "API" },
          ToService: { id: "redis", name: "Redis" }
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
      limit: 20
    });

    expect(items.some((row) => row.kind === "alert" && row.title === "Redis unreachable")).toBe(true);
    expect(items.some((row) => row.kind === "heal" && row.title === "Worker auto-restarted")).toBe(true);
    expect(items.some((row) => row.kind === "check" && row.title === "Health check failed")).toBe(true);
    expect(items.some((row) => row.kind === "heartbeat" && row.title === "Heartbeat received")).toBe(true);
    expect(items.some((row) => row.kind === "deploy" && row.subject?.includes("1.4.2"))).toBe(true);
    expect(items.some((row) => row.kind === "dependency" && row.subject === "API → Redis")).toBe(true);
    expect(items.every((row) => !/queue depth|baseline|%\s*prediction|saturation/i.test(`${row.title} ${row.detail}`))).toBe(
      true
    );
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

  it("emits restart-near-deploy insight only with correlated facts", () => {
    const withEvidence = buildOpsInsights({
      projectId: "proj-1",
      remediationLogs: [
        {
          id: "r1",
          projectId: "proj-1",
          action: "RESTART_WORKER",
          status: "SUCCEEDED",
          createdAt: "2026-07-14T11:57:00.000Z",
          executedAt: "2026-07-14T11:57:00.000Z"
        },
        {
          id: "r2",
          projectId: "proj-1",
          action: "RESTART_WORKER",
          status: "SUCCEEDED",
          createdAt: "2026-07-14T11:58:00.000Z",
          executedAt: "2026-07-14T11:58:00.000Z"
        }
      ],
      changeEvents: [
        {
          id: "ce1",
          eventType: "DEPLOY_RELEASE",
          summary: "Ship",
          occurredAt: "2026-07-14T11:56:30.000Z"
        }
      ],
      nowMs: Date.parse("2026-07-14T12:00:00.000Z")
    });
    expect(withEvidence.some((row) => row.id === "restarts-near-deploy")).toBe(true);

    const without = buildOpsInsights({
      projectId: "proj-1",
      remediationLogs: [
        {
          id: "r1",
          projectId: "proj-1",
          action: "RERUN_HTTP_CHECK",
          status: "SUCCEEDED",
          createdAt: "2026-07-14T11:57:00.000Z",
          executedAt: "2026-07-14T11:57:00.000Z"
        }
      ],
      changeEvents: [],
      nowMs: Date.parse("2026-07-14T12:00:00.000Z")
    });
    expect(without).toHaveLength(0);
  });

  it("derives learning stage from age and signal volume without inventing early confidence", () => {
    const week1 = deriveLearningProgression({
      project: {
        createdAt: "2026-07-12T00:00:00.000Z",
        heartbeats: [{ receivedAt: "2026-07-13T00:00:00.000Z" }]
      },
      nowMs: Date.parse("2026-07-14T12:00:00.000Z")
    });
    expect(week1.stage).toBe("collecting_signals");
    expect(week1.confidencePercent).toBeNull();
    expect(week1.label).toMatch(/Collecting signals/i);

    const matured = deriveLearningProgression({
      project: {
        createdAt: "2025-12-01T00:00:00.000Z",
        heartbeats: Array.from({ length: 40 }, (_, i) => ({
          receivedAt: new Date(Date.parse("2026-07-01T00:00:00.000Z") + i * 3600_000).toISOString()
        })),
        alerts: Array.from({ length: 30 }, (_, i) => ({
          id: `a${i}`,
          title: "x",
          status: "OPEN",
          lastSeenAt: "2026-07-14T00:00:00.000Z"
        })),
        events: Array.from({ length: 30 }, (_, i) => ({
          id: `e${i}`,
          type: "DEPLOYMENT_FINISHED",
          message: "ok",
          createdAt: "2026-07-14T00:00:00.000Z"
        }))
      },
      topology: {
        ...topology,
        edges: [
          { id: "e1", sourceId: "a", targetId: "b", type: "DEPENDENCY", critical: false, status: "HEALTHY" },
          { id: "e2", sourceId: "b", targetId: "c", type: "DEPENDENCY", critical: false, status: "HEALTHY" },
          { id: "e3", sourceId: "c", targetId: "d", type: "DEPENDENCY", critical: false, status: "HEALTHY" }
        ]
      },
      dependencyCount: 3,
      checkResultCount: 60,
      remediationCount: 8,
      changeEventCount: 5,
      nowMs: Date.parse("2026-07-14T12:00:00.000Z")
    });
    expect(matured.stage).toBe("prediction_ready");
    expect(matured.confidencePercent).toBeTypeOf("number");
    expect(matured.confidencePercent).toBeGreaterThan(0);
    expect(matured.label).toMatch(/Prediction confidence:/);
  });
});
