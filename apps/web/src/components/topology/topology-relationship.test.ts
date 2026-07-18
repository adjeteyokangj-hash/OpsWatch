import { describe, expect, it } from "vitest";
import {
  auditTopologyRelationships,
  buildNodeRelationshipDiagnostics,
  isolationBadgeLabel,
  matchesConnectionFilter,
  summarizeRelationshipDiagnostics
} from "./topology-relationship";
import { computeLayeredLayout } from "./topology-layout";
import { resolveDependencyDisplayLinks, resolveHierarchyDisplayLinks } from "./topology-edge-resolve";
import type { ProjectTopologyResponse } from "./topology-types";

const nobleLikeTopology = (): ProjectTopologyResponse => ({
  project: { id: "app-noble-express", name: "Noble Express", status: "DEGRADED" },
  generatedAt: "2026-07-15T19:00:00.000Z",
  nodes: [
    {
      id: "app",
      name: "Noble Express",
      type: "APP",
      status: "DEGRADED",
      parentId: null,
      metrics: { availabilityPercent: 99, latencyMs: 10, errorRatePercent: 0, sloBurnRate: null, availabilityTrend: [] },
      risk: { openAlerts: 0, unresolvedIncidents: 0 }
    },
    {
      id: "svc-communications",
      name: "Communications",
      type: "MODULE",
      status: "HEALTHY",
      parentId: "app",
      metrics: { availabilityPercent: 99, latencyMs: 10, errorRatePercent: 0, sloBurnRate: null, availabilityTrend: [] },
      risk: { openAlerts: 0, unresolvedIncidents: 0 }
    },
    {
      id: "area-admin-portal",
      name: "Admin Portal",
      type: "MODULE",
      status: "UNKNOWN",
      parentId: null,
      metrics: { availabilityPercent: null, latencyMs: null, errorRatePercent: null, sloBurnRate: null, availabilityTrend: [] },
      risk: { openAlerts: 0, unresolvedIncidents: 0 }
    },
    {
      id: "wf-email",
      name: "Email Notification Flow",
      type: "WORKFLOW",
      status: "HEALTHY",
      parentId: "svc-communications",
      metrics: { availabilityPercent: 99, latencyMs: 10, errorRatePercent: 0, sloBurnRate: null, availabilityTrend: [] },
      risk: { openAlerts: 0, unresolvedIncidents: 0 }
    }
  ],
  edges: [
    {
      id: "h1",
      sourceId: "svc-communications",
      targetId: "app",
      type: "HIERARCHY",
      critical: false,
      status: "HEALTHY"
    },
    {
      id: "h2",
      sourceId: "wf-email",
      targetId: "svc-communications",
      type: "HIERARCHY",
      critical: false,
      status: "HEALTHY"
    }
  ],
  summary: {
    total: 4,
    healthy: 2,
    degraded: 1,
    critical: 0,
    unknown: 1,
    openAlerts: 0,
    openIncidents: 0
  },
  nodeContext: {
    "area-admin-portal": {
      monitoringState: "AWAITING_FIRST_CHECK",
      lastCheckAt: null,
      lastCheckStatus: null,
      sloStatus: null,
      openAlerts: [],
      unresolvedIncidents: [],
      upstreamIds: [],
      downstreamIds: []
    }
  }
});

describe("topology-relationship", () => {
  it("marks zero-degree monitored areas as discovery incomplete", () => {
    const diagnostics = buildNodeRelationshipDiagnostics(nobleLikeTopology());
    const admin = diagnostics.find((row) => row.moduleId === "area-admin-portal");
    expect(admin?.connectionState).toBe("discovery_incomplete");
    expect(isolationBadgeLabel(admin!.connectionState)).toBe("Discovery pending");
    expect(admin?.isolatedStateReason).toMatch(/discovery pending/i);
  });

  it("marks modules with relationships as connected", () => {
    const diagnostics = buildNodeRelationshipDiagnostics(nobleLikeTopology());
    const communications = diagnostics.find((row) => row.moduleId === "svc-communications");
    expect(communications?.connectionState).toBe("connected");
    expect(communications?.totalRelationshipCount).toBeGreaterThan(0);
  });

  it("summarises connected vs unconnected modules", () => {
    const summary = summarizeRelationshipDiagnostics(buildNodeRelationshipDiagnostics(nobleLikeTopology()));
    expect(summary.totalModules).toBe(2);
    expect(summary.connectedModules).toBe(1);
    expect(summary.discoveryPendingModules).toBe(1);
  });

  it("filters connection states", () => {
    expect(matchesConnectionFilter("connected", "CONNECTED")).toBe(true);
    expect(matchesConnectionFilter("discovery_incomplete", "UNCONNECTED")).toBe(true);
    expect(matchesConnectionFilter("connected", "DISCOVERY_PENDING")).toBe(false);
  });
});

describe("APP hierarchy anchors restore module relationships", () => {
  it("renders hierarchy edges to the APP root and paints the APP master card", () => {
    const topology = nobleLikeTopology();
    const layout = computeLayeredLayout(topology.nodes);
    expect(layout.positions.has("app")).toBe(true);
    expect(layout.visibleNodeIds.has("app")).toBe(true);

    const hierarchy = resolveHierarchyDisplayLinks(topology.edges, topology.nodes, layout);
    expect(hierarchy.some((link) => link.childId === "svc-communications" && link.parentId === "app")).toBe(true);
    expect(hierarchy.some((link) => link.childId === "wf-email" && link.parentId === "svc-communications")).toBe(true);

    const dependency = resolveDependencyDisplayLinks(topology.edges, layout);
    const rendered = new Set([...hierarchy.map((row) => row.key), ...dependency.map((row) => row.key)]);
    const audit = auditTopologyRelationships({ topology, renderedEdgeKeys: rendered });
    expect(audit.zeroDegreeModules).toEqual(["area-admin-portal"]);
    expect(audit.edgesAbsentFromRenderedGraph).toEqual([]);
  });

  it("reports missing source or target nodes", () => {
    const topology = nobleLikeTopology();
    topology.edges.push({
      id: "broken",
      sourceId: "missing-source",
      targetId: "svc-communications",
      type: "DEPENDENCY",
      critical: false,
      status: "UNKNOWN"
    });
    const audit = auditTopologyRelationships({
      topology,
      renderedEdgeKeys: new Set()
    });
    expect(audit.missingSourceNodeIds).toContain("missing-source");
  });
});
