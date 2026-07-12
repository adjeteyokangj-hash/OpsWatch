import { describe, expect, it } from "vitest";
import { buildProjectTopologyResponse } from "./topology.service";

describe("topology.service", () => {
  const project = { id: "proj-1", name: "Noble Express", status: "DEGRADED" };

  const services = [
    {
      id: "app",
      name: "Noble Express",
      type: "APP" as const,
      status: "HEALTHY",
      Check: [{ isActive: true, CheckResult: [{ status: "PASS", checkedAt: new Date(), responseTimeMs: 120 }] }]
    },
    {
      id: "quotes-module",
      name: "Quotes",
      type: "MODULE" as const,
      status: "HEALTHY",
      Check: [{ isActive: true, CheckResult: [{ status: "PASS", checkedAt: new Date(), responseTimeMs: 90 }] }]
    },
    {
      id: "redis",
      name: "Redis",
      type: "COMPONENT" as const,
      status: "HEALTHY",
      Check: []
    }
  ];

  const dependencies = [
    {
      id: "h1",
      fromServiceId: "quotes-module",
      toServiceId: "app",
      dependencyType: "HIERARCHY",
      criticality: "HIGH",
      isActive: true
    },
    {
      id: "d1",
      fromServiceId: "quotes-module",
      toServiceId: "redis",
      dependencyType: "RUNTIME",
      criticality: "CRITICAL",
      isActive: true
    }
  ];

  it("derives availability from recent checks when SLO windows are absent", () => {
    const topology = buildProjectTopologyResponse({
      project,
      services,
      dependencies,
      alerts: [],
      incidents: [],
      slos: []
    });

    const quotes = topology.nodes.find((row) => row.id === "quotes-module");
    expect(quotes?.metrics.availabilityPercent).toBe(100);
    expect(quotes?.metrics.latencyMs).toBe(90);
    expect(quotes?.metrics.availabilityTrend.length).toBeGreaterThan(0);
  });

  it("returns four-layer nodes with hierarchy and dependency edges", () => {
    const topology = buildProjectTopologyResponse({
      project,
      services,
      dependencies,
      alerts: [],
      incidents: [],
      slos: []
    });

    expect(topology.nodes.map((row) => row.type)).toEqual(["APP", "MODULE", "COMPONENT"]);
    expect(topology.edges.some((row) => row.type === "HIERARCHY")).toBe(true);
    expect(topology.edges.some((row) => row.type === "DEPENDENCY" && row.critical)).toBe(true);
    expect(topology.nodes.find((row) => row.id === "quotes-module")?.parentId).toBe("app");
  });

  it("keeps services without checks in UNKNOWN state", () => {
    const topology = buildProjectTopologyResponse({
      project,
      services,
      dependencies,
      alerts: [],
      incidents: [],
      slos: []
    });

    const redis = topology.nodes.find((row) => row.id === "redis");
    expect(redis?.status).toBe("UNKNOWN");
    expect(topology.nodeContext.redis?.monitoringState).toBe("AWAITING_FIRST_CHECK");
    expect(topology.summary.unknown).toBe(1);
  });

  it("aggregates alert and incident scoped risk", () => {
    const topology = buildProjectTopologyResponse({
      project,
      services,
      dependencies,
      alerts: [
        {
          id: "alert-1",
          title: "Redis unreachable",
          severity: "CRITICAL",
          status: "OPEN",
          serviceId: "redis"
        }
      ],
      incidents: [],
      slos: []
    });

    expect(topology.summary.openAlerts).toBe(1);
    expect(topology.nodes.find((row) => row.id === "redis")?.status).toBe("UNKNOWN");
    expect(topology.nodes.find((row) => row.id === "redis")?.risk.openAlerts).toBe(1);
  });

  it("marks monitored services degraded when alerts exist", () => {
    const topology = buildProjectTopologyResponse({
      project,
      services,
      dependencies,
      alerts: [
        {
          id: "alert-2",
          title: "Quote failures",
          severity: "HIGH",
          status: "OPEN",
          serviceId: "quotes-module"
        }
      ],
      incidents: [],
      slos: []
    });

    expect(topology.nodes.find((row) => row.id === "quotes-module")?.status).toBe("CRITICAL");
    expect(topology.summary.critical).toBe(1);
  });
});
