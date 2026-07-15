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

  it("uses project heartbeats for APP metrics when checks are absent", () => {
    const topology = buildProjectTopologyResponse({
      project,
      services: [
        {
          id: "app",
          name: "Noble Express",
          type: "APP" as const,
          status: "HEALTHY",
          Check: []
        }
      ],
      dependencies: [],
      alerts: [],
      incidents: [],
      slos: [],
      heartbeats: [
        { status: "UP", receivedAt: new Date("2026-07-12T10:00:00Z") },
        { status: "UP", receivedAt: new Date("2026-07-12T09:55:00Z") }
      ]
    });

    const app = topology.nodes.find((row) => row.id === "app");
    expect(app?.metrics.availabilityPercent).toBe(100);
    expect(app?.metrics.availabilityTrend).toEqual([100, 100]);
  });

  it("rolls parent metrics up from monitored children", () => {
    const topology = buildProjectTopologyResponse({
      project,
      services: [
        {
          id: "app",
          name: "Noble Express",
          type: "APP" as const,
          status: "HEALTHY",
          Check: []
        },
        {
          id: "quotes-module",
          name: "Quotes",
          type: "MODULE" as const,
          status: "HEALTHY",
          Check: []
        },
        {
          id: "quote-api",
          name: "Quote API",
          type: "COMPONENT" as const,
          status: "HEALTHY",
          Check: [
            {
              isActive: true,
              CheckResult: [
                { status: "PASS", checkedAt: new Date(), responseTimeMs: 80 },
                { status: "FAIL", checkedAt: new Date(Date.now() - 60_000), responseTimeMs: 120 }
              ]
            }
          ]
        }
      ],
      dependencies: [
        {
          id: "h1",
          fromServiceId: "quotes-module",
          toServiceId: "app",
          dependencyType: "HIERARCHY",
          criticality: "HIGH",
          isActive: true
        },
        {
          id: "h2",
          fromServiceId: "quote-api",
          toServiceId: "quotes-module",
          dependencyType: "HIERARCHY",
          criticality: "HIGH",
          isActive: true
        }
      ],
      alerts: [],
      incidents: [],
      slos: []
    });

    const module = topology.nodes.find((row) => row.id === "quotes-module");
    expect(module?.metrics.availabilityPercent).toBe(50);
    expect(module?.metrics.availabilityTrend.length).toBeGreaterThan(0);
    expect(topology.nodeContext["quotes-module"]?.monitoringState).toBe("MONITORED");
  });

  it("builds dependency edge health from post-rollup evidence, not pre-rollup UNKNOWN parents", () => {
    const topology = buildProjectTopologyResponse({
      project,
      services: [
        {
          id: "app",
          name: "Noble Express",
          type: "APP" as const,
          status: "HEALTHY",
          Check: []
        },
        {
          id: "quotes-module",
          name: "Quotes",
          type: "MODULE" as const,
          status: "HEALTHY",
          Check: []
        },
        {
          id: "quote-api",
          name: "Quote API",
          type: "COMPONENT" as const,
          status: "HEALTHY",
          Check: [
            {
              isActive: true,
              CheckResult: [{ status: "PASS", checkedAt: new Date(), responseTimeMs: 40 }]
            }
          ]
        },
        {
          id: "redis",
          name: "Redis",
          type: "COMPONENT" as const,
          status: "HEALTHY",
          Check: [
            {
              isActive: true,
              CheckResult: [{ status: "PASS", checkedAt: new Date(), responseTimeMs: 5 }]
            }
          ]
        }
      ],
      dependencies: [
        {
          id: "h1",
          fromServiceId: "quotes-module",
          toServiceId: "app",
          dependencyType: "HIERARCHY",
          criticality: "HIGH",
          isActive: true
        },
        {
          id: "h2",
          fromServiceId: "quote-api",
          toServiceId: "quotes-module",
          dependencyType: "HIERARCHY",
          criticality: "HIGH",
          isActive: true
        },
        {
          id: "d1",
          fromServiceId: "quote-api",
          toServiceId: "redis",
          dependencyType: "RUNTIME",
          criticality: "CRITICAL",
          isActive: true
        }
      ],
      alerts: [],
      incidents: [],
      slos: []
    });

    const hierarchyToApp = topology.edges.find((row) => row.id === "h1");
    const dependency = topology.edges.find((row) => row.id === "d1");
    expect(topology.nodes.find((row) => row.id === "app")?.status).toBe("HEALTHY");
    expect(hierarchyToApp?.status).toBe("HEALTHY");
    expect(dependency?.status).toBe("HEALTHY");
  });

  it("paints dependency CRITICAL when a linked endpoint alert exists even if the target lacks checks", () => {
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

    expect(topology.nodes.find((row) => row.id === "redis")?.status).toBe("UNKNOWN");
    const dependency = topology.edges.find((row) => row.id === "d1");
    expect(dependency?.status).toBe("CRITICAL");
  });

  it("keeps unmonitored dependencies UNKNOWN without inventing green from source-only health", () => {
    const topology = buildProjectTopologyResponse({
      project,
      services,
      dependencies,
      alerts: [],
      incidents: [],
      slos: []
    });

    const dependency = topology.edges.find((row) => row.id === "d1");
    expect(dependency?.status).toBe("UNKNOWN");
    expect(topology.nodes.find((row) => row.id === "quotes-module")?.status).toBe("HEALTHY");
  });
});
