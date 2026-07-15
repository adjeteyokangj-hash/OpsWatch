import { describe, expect, it } from "vitest";
import {
  TOPOLOGY_KEY_ENTRIES,
  HIERARCHY_EDGE_COLOR,
  HIERARCHY_WRITTEN_HEALTH,
  colourMeaningForEdge,
  dependencyEdgeColorClass,
  describeSelectedEdge,
  edgeTooltipLines,
  resolveEndpointDisplayName
} from "./topology-edge-style";
import type { TopologyEdge, TopologyNode } from "./topology-types";
import { formatMoreNodeLabel, moreNodeId } from "./topology-visual-layers";

const emptyMetrics = {
  availabilityPercent: null,
  latencyMs: null,
  errorRatePercent: null,
  sloBurnRate: null,
  availabilityTrend: [] as number[]
};

const node = (
  id: string,
  name: string,
  status: TopologyNode["status"] = "HEALTHY",
  extras: Partial<TopologyNode> = {}
): TopologyNode => ({
  id,
  name,
  type: "MODULE",
  status,
  parentId: null,
  metrics: emptyMetrics,
  risk: { openAlerts: 0, unresolvedIncidents: 0 },
  ...extras
});

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
      ["a", node("a", "API")],
      [
        "b",
        node("b", "Redis", "CRITICAL", {
          type: "COMPONENT",
          risk: { openAlerts: 1, unresolvedIncidents: 0 }
        })
      ]
    ]);
    const selected = describeSelectedEdge(edge, nodes, "dependency");
    expect(selected.sourceName).toBe("API");
    expect(selected.targetName).toBe("Redis");
    expect(selected.writtenHealth).toBe("Critical");
    expect(selected.colourMeaning).toMatch(/Red solid/i);
  });

  it("hierarchy written health is containment, never Unknown", () => {
    const edge: TopologyEdge = {
      id: "h1",
      sourceId: "child",
      targetId: "parent",
      type: "HIERARCHY",
      critical: false,
      status: "UNKNOWN"
    };
    const nodes = new Map<string, TopologyNode>([
      ["child", node("child", "Customer Portal", "UNKNOWN")],
      ["parent", node("parent", "Noble Express", "HEALTHY", { type: "APP" })]
    ]);
    const selected = describeSelectedEdge(edge, nodes, "hierarchy");
    expect(selected.writtenHealth).toBe(HIERARCHY_WRITTEN_HEALTH);
    expect(selected.writtenHealth).not.toMatch(/unknown/i);
    expect(selected.structureNote).toMatch(/dependency lines/i);

    const tooltip = edgeTooltipLines(selected);
    expect(tooltip).toContain("Health: Not applicable (containment)");
    expect(tooltip).not.toContain("Health: Unknown");
    expect(tooltip).toMatch(/Grey dashed/i);
    expect(tooltip).toMatch(/structure only/i);
  });

  it("never surfaces raw more: ids — resolves to +N more workflows", () => {
    const moreId = moreNodeId("WORKFLOW", 0);
    const edge: TopologyEdge = {
      id: "h-more",
      sourceId: "portal",
      targetId: moreId,
      type: "HIERARCHY",
      critical: false,
      status: "UNKNOWN"
    };
    const nodes = new Map<string, TopologyNode>([["portal", node("portal", "Customer Portal")]]);
    const moreNodes = [{ id: moreId, layer: "WORKFLOW" as const, hiddenCount: 4 }];
    const selected = describeSelectedEdge(edge, nodes, "hierarchy", { moreNodes });
    expect(selected.targetName).toBe(formatMoreNodeLabel(4, "WORKFLOW"));
    expect(selected.targetName).toBe("+4 more workflows");
    expect(selected.targetName).not.toContain("more:");
    expect(edgeTooltipLines(selected)).not.toContain(moreId);
    expect(resolveEndpointDisplayName(moreId, nodes, moreNodes)).toBe("+4 more workflows");
  });

  it("surfaces discovery-pending notes on hierarchy tooltips instead of blank Unknown", () => {
    const edge: TopologyEdge = {
      id: "h2",
      sourceId: "portal",
      targetId: "app",
      type: "HIERARCHY",
      critical: false,
      status: "UNKNOWN"
    };
    const nodes = new Map<string, TopologyNode>([
      ["portal", node("portal", "Customer Portal", "UNKNOWN")],
      ["app", node("app", "Noble Express", "HEALTHY", { type: "APP" })]
    ]);
    const endpointNotesById = new Map([
      [
        "portal",
        "Relationship discovery pending — OpsWatch has not mapped dependencies for this module yet."
      ]
    ]);
    const selected = describeSelectedEdge(edge, nodes, "hierarchy", { endpointNotesById });
    const tooltip = edgeTooltipLines(selected);
    expect(tooltip).toMatch(/discovery pending/i);
    expect(tooltip).not.toContain("Health: Unknown");
  });
});
