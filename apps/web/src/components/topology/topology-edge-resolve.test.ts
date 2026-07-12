import { describe, expect, it } from "vitest";
import { computeLayeredLayout } from "./topology-layout";
import type { TopologyEdge, TopologyNode } from "./topology-types";
import { resolveHierarchyDisplayLinks } from "./topology-edge-resolve";

const node = (
  id: string,
  name: string,
  type: TopologyNode["type"],
  parentId: string | null = null
): TopologyNode => ({
  id,
  name,
  type,
  status: "UNKNOWN",
  parentId,
  metrics: {
    availabilityPercent: null,
    latencyMs: null,
    errorRatePercent: null,
    sloBurnRate: null,
    availabilityTrend: []
  },
  risk: { openAlerts: 0, unresolvedIncidents: 0 }
});

describe("resolveHierarchyDisplayLinks", () => {
  it("bridges hidden parents to the layer more-card", () => {
    const nodes = [
      node("app", "Noble Express", "APP"),
      node("quotes", "Quotes", "MODULE", "app"),
      node("quote-flow", "Quote Flow", "WORKFLOW", "quotes")
    ];
    const edges: TopologyEdge[] = [
      {
        id: "h1",
        sourceId: "quotes",
        targetId: "app",
        type: "HIERARCHY",
        critical: true,
        status: "UNKNOWN"
      },
      {
        id: "h2",
        sourceId: "quote-flow",
        targetId: "quotes",
        type: "HIERARCHY",
        critical: true,
        status: "UNKNOWN"
      }
    ];

    const layout = computeLayeredLayout(nodes.filter((row) => row.type !== "APP"));
    const links = resolveHierarchyDisplayLinks(edges, nodes, layout);

    expect(links.some((row) => row.childId === "quote-flow")).toBe(true);
    expect(links.find((row) => row.childId === "quote-flow")?.parentId).toBeTruthy();
  });

  it("skips app-only parents and still links visible workflow to visible module", () => {
    const nodes = [
      node("app", "Noble Express", "APP"),
      node("quotes", "Quotes", "MODULE", "app"),
      node("shipments", "Shipments", "MODULE", "app"),
      node("tracking", "Tracking", "MODULE", "app"),
      node("communications", "Communications", "MODULE", "app"),
      node("quote-flow", "Quote Flow", "WORKFLOW", "quotes")
    ];
    const edges: TopologyEdge[] = [
      { id: "h1", sourceId: "quote-flow", targetId: "quotes", type: "HIERARCHY", critical: true, status: "UNKNOWN" }
    ];

    const layout = computeLayeredLayout(nodes.filter((row) => row.type !== "APP"));
    const links = resolveHierarchyDisplayLinks(edges, nodes, layout);

    const quoteFlowLink = links.find((row) => row.childId === "quote-flow");
    expect(quoteFlowLink?.parentId).toBe("quotes");
  });
});
