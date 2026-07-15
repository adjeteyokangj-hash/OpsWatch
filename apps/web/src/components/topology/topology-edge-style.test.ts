import { describe, expect, it } from "vitest";
import {
  TOPOLOGY_KEY_ENTRIES,
  HIERARCHY_EDGE_COLOR,
  colourMeaningForEdge,
  dependencyEdgeColorClass,
  describeSelectedEdge
} from "./topology-edge-style";
import type { TopologyEdge, TopologyNode } from "./topology-types";

describe("topology edge style / Topology key", () => {
  it("documents every rendered line colour and style (no unexplained purple edge colour)", () => {
    const ids = TOPOLOGY_KEY_ENTRIES.map((entry) => entry.id);
    expect(ids).toEqual(
      expect.arrayContaining(["healthy", "degraded", "critical", "unknown", "remediating", "hierarchy", "dependency"])
    );
    expect(TOPOLOGY_KEY_ENTRIES.some((entry) => /purple/i.test(entry.label) || /purple/i.test(entry.meaning))).toBe(
      false
    );
    expect(HIERARCHY_EDGE_COLOR).toBe("#94a3b8");
  });

  it("maps dependency health to documented colour classes", () => {
    expect(dependencyEdgeColorClass("HEALTHY")).toBe("topology-health-healthy");
    expect(dependencyEdgeColorClass("DEGRADED")).toBe("topology-health-degraded");
    expect(dependencyEdgeColorClass("CRITICAL")).toBe("topology-health-critical");
    expect(dependencyEdgeColorClass("UNKNOWN")).toBe("topology-health-unknown");
  });

  it("explains hierarchy as grey dashed, not layer purple", () => {
    expect(colourMeaningForEdge("hierarchy", "HEALTHY")).toMatch(/Grey dashed/i);
    expect(colourMeaningForEdge("dependency", "CRITICAL")).toMatch(/Red solid/i);
  });

  it("describeSelectedEdge carries written health and colour meaning", () => {
    const edge: TopologyEdge = {
      id: "e1",
      sourceId: "a",
      targetId: "b",
      type: "DEPENDENCY",
      critical: true,
      status: "CRITICAL"
    };
    const nodes = new Map<string, TopologyNode>([
      [
        "a",
        {
          id: "a",
          name: "API",
          type: "MODULE",
          status: "HEALTHY",
          parentId: null,
          metrics: {
            availabilityPercent: null,
            latencyMs: null,
            errorRatePercent: null,
            sloBurnRate: null,
            availabilityTrend: []
          },
          risk: { openAlerts: 0, unresolvedIncidents: 0 }
        }
      ],
      [
        "b",
        {
          id: "b",
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
      ]
    ]);
    const selected = describeSelectedEdge(edge, nodes, "dependency");
    expect(selected.sourceName).toBe("API");
    expect(selected.targetName).toBe("Redis");
    expect(selected.writtenHealth).toBe("Critical");
    expect(selected.colourMeaning).toMatch(/Red solid/i);
  });
});
