import { describe, expect, it } from "vitest";
import type { ProjectTopologyResponse } from "../types/dto";
import { preserveUnmappedLegacyServices } from "./topology-reader-safety";

const emptySummary = {
  total: 0,
  healthy: 0,
  degraded: 0,
  critical: 0,
  unknown: 0,
  openAlerts: 0,
  openIncidents: 0
};

const topology = (nodes: ProjectTopologyResponse["nodes"]): ProjectTopologyResponse => ({
  project: { id: "proj-1", name: "Harbor Ledger", status: "UNKNOWN" },
  generatedAt: "2026-10-18T09:00:00.000Z",
  nodes,
  edges: [],
  summary: { ...emptySummary, total: nodes.length, unknown: nodes.length },
  nodeContext: Object.fromEntries(
    nodes.map((node) => [
      node.id,
      {
        monitoringState: "AWAITING_FIRST_CHECK" as const,
        lastCheckAt: null,
        lastCheckStatus: null,
        sloStatus: null,
        openAlerts: [],
        unresolvedIncidents: [],
        upstreamIds: [],
        downstreamIds: []
      }
    ])
  )
});

const cloud = {
  id: "svc-cloud",
  name: "Cloud reachability",
  type: "COMPONENT" as const,
  status: "UNKNOWN" as const,
  parentId: null,
  metrics: {
    availabilityPercent: null,
    latencyMs: null,
    errorRatePercent: null,
    sloBurnRate: null,
    availabilityTrend: []
  },
  risk: { openAlerts: 0, unresolvedIncidents: 0 }
};

describe("preserveUnmappedLegacyServices", () => {
  it("keeps an existing service when the canonical graph is empty", () => {
    const canonical = topology([]);
    canonical.readerDiagnostic = {
      reader: "CANONICAL",
      fallbackUsed: false,
      canonicalEntityCount: 0,
      canonicalRelationshipCount: 0,
      legacyFallbackCount: 0,
      unresolvedCanonicalReferences: 0,
      details: []
    };

    const merged = preserveUnmappedLegacyServices(canonical, topology([cloud]));

    expect(merged.nodes.map((node) => node.name)).toEqual(["Cloud reachability"]);
    expect(merged.readerDiagnostic?.fallbackUsed).toBe(true);
    expect(merged.readerDiagnostic?.legacyFallbackCount).toBe(1);
    expect(merged.summary.total).toBe(1);
  });

  it("does not duplicate a legacy service that already has a canonical entity", () => {
    const canonical = topology([{ ...cloud, id: "entity-cloud", name: "Cloud reachability" }]);
    canonical.nodeContext["entity-cloud"] = {
      ...canonical.nodeContext["entity-cloud"]!,
      canonical: {
        environment: "production",
        entityType: "COMPONENT",
        provenance: "DECLARED",
        discoverySource: null,
        discoveryState: "ACTIVE",
        freshness: "UNKNOWN",
        confidence: null,
        confirmationState: "CONFIRMED",
        sharedScope: "PROJECT",
        isTestSeed: false,
        legacyServiceId: "svc-cloud",
        location: null
      }
    };

    const merged = preserveUnmappedLegacyServices(canonical, topology([cloud]));

    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0]?.id).toBe("entity-cloud");
    expect(merged.readerDiagnostic).toBeUndefined();
  });
});
