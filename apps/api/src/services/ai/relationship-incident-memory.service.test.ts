import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  findFirst,
  findUnique,
  findMany,
  update,
  automationRunFindMany,
  incidentMemoryFindMany
} = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  automationRunFindMany: vi.fn(),
  incidentMemoryFindMany: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    project: { findFirst },
    incidentMemoryEntry: { findMany: incidentMemoryFindMany },
    automationRun: { findMany: automationRunFindMany }
  }
}));

vi.mock("../topology-loader.service", () => ({
  loadProjectTopology: vi.fn()
}));

vi.mock("./incident-memory.service", () => ({
  findSimilarIncidents: vi.fn()
}));

import { loadProjectTopology } from "../topology-loader.service";
import { findSimilarIncidents } from "./incident-memory.service";
import { getRelationshipIncidentMemorySignals } from "./relationship-incident-memory.service";

const topology = {
  project: { id: "proj-1", name: "Noble Express", status: "DEGRADED" },
  generatedAt: "2026-07-15T10:00:00.000Z",
  nodes: [
    { id: "mod-a", name: "Checkout", type: "MODULE", status: "DEGRADED", parentId: null, metrics: {}, risk: {} },
    { id: "svc-b", name: "Payments API", type: "COMPONENT", status: "CRITICAL", parentId: null, metrics: {}, risk: {} }
  ],
  edges: [
    {
      id: "edge-critical",
      sourceId: "mod-a",
      targetId: "svc-b",
      type: "DEPENDENCY",
      critical: false,
      status: "CRITICAL"
    }
  ],
  summary: {
    total: 2,
    healthy: 0,
    degraded: 1,
    critical: 1,
    unknown: 0,
    openAlerts: 1,
    openIncidents: 1
  },
  nodeContext: {
    "mod-a": {
      monitoringState: "MONITORED",
      lastCheckAt: "2026-07-15T10:00:00.000Z",
      lastCheckStatus: "FAIL",
      sloStatus: "BREACHED",
      openAlerts: [{ id: "alert-1", title: "Payments dependency failing", severity: "HIGH", status: "OPEN" }],
      unresolvedIncidents: [],
      upstreamIds: [],
      downstreamIds: ["svc-b"]
    },
    "svc-b": {
      monitoringState: "MONITORED",
      lastCheckAt: "2026-07-15T10:01:00.000Z",
      lastCheckStatus: "FAIL",
      sloStatus: "BREACHED",
      openAlerts: [],
      unresolvedIncidents: [],
      upstreamIds: ["mod-a"],
      downstreamIds: []
    }
  }
};

describe("relationship-incident-memory.service", () => {
  beforeEach(() => {
    vi.mocked(loadProjectTopology).mockReset();
    vi.mocked(findSimilarIncidents).mockReset();
    incidentMemoryFindMany.mockReset();
    automationRunFindMany.mockReset();
  });

  it("returns null when topology edge is missing", async () => {
    vi.mocked(loadProjectTopology).mockResolvedValueOnce(topology as never);
    const result = await getRelationshipIncidentMemorySignals({
      organizationId: "org-1",
      projectId: "proj-1",
      edgeId: "missing-edge"
    });
    expect(result).toBeNull();
  });

  it("returns null for hierarchy edges", async () => {
    vi.mocked(loadProjectTopology).mockResolvedValueOnce({
      ...topology,
      edges: [{ id: "h1", sourceId: "mod-a", targetId: "svc-b", type: "HIERARCHY", critical: false, status: "UNKNOWN" }]
    } as never);
    const result = await getRelationshipIncidentMemorySignals({
      organizationId: "org-1",
      projectId: "proj-1",
      edgeId: "h1"
    });
    expect(result).toBeNull();
  });

  it("aggregates incident memory signals for dependency edges", async () => {
    vi.mocked(loadProjectTopology).mockResolvedValueOnce(topology as never);
    vi.mocked(findSimilarIncidents).mockResolvedValueOnce([
      {
        incidentId: "inc-a",
        title: "Example incident A",
        similarity: 0.9,
        resolvedAt: "2026-06-01T10:00:00.000Z"
      },
      {
        incidentId: "inc-b",
        title: "Example incident B",
        similarity: 0.72,
        resolvedAt: "2026-06-10T10:00:00.000Z"
      }
    ] as never);
    incidentMemoryFindMany.mockResolvedValueOnce([
      { incidentId: "inc-a", resolutionTimeMs: 120000, resolvedAt: new Date("2026-06-01T10:02:00.000Z") },
      { incidentId: "inc-b", resolutionTimeMs: 240000, resolvedAt: new Date("2026-06-10T10:04:00.000Z") }
    ]);
    automationRunFindMany.mockResolvedValueOnce([
      {
        incidentId: "inc-a",
        affectedServiceIds: ["svc-b"],
        Steps: [{ targetServiceId: "svc-b" }],
        Outcomes: [{ success: true }]
      }
    ]);

    const result = await getRelationshipIncidentMemorySignals({
      organizationId: "org-1",
      projectId: "proj-1",
      edgeId: "edge-critical"
    });

    expect(result?.occurrenceCount).toBe(2);
    expect(result?.averagePatternSimilarity).toBeCloseTo(0.81, 1);
    expect(result?.previousFixCount).toBe(1);
    expect(result?.successRate).toBe(1);
    expect(result?.matches[0]?.incidentId).toBe("inc-a");
  });
});
