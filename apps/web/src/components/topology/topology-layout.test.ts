import { describe, expect, it } from "vitest";
import { computeLayeredLayout, LAYOUT, nodesPerRowForWidth, presentationEdgePath, PRESENTATION_LAYOUT } from "./topology-layout";
import type { TopologyNode } from "./topology-types";

const node = (id: string, type: TopologyNode["type"] = "MODULE"): TopologyNode => ({
  id,
  name: id,
  type,
  status: "UNKNOWN",
  parentId: null,
  metrics: {
    availabilityPercent: null,
    latencyMs: null,
    errorRatePercent: null,
    sloBurnRate: null,
    availabilityTrend: []
  },
  risk: {
    openAlerts: 0,
    unresolvedIncidents: 0
  }
});

describe("computeLayeredLayout", () => {
  it("spreads a wide layer across the canvas instead of clustering in the middle", () => {
    const nodes = Array.from({ length: 12 }, (_, index) => node(`module-${index}`));
    const layout = computeLayeredLayout(nodes, new Set(["layer:MODULE"]), 1600);
    const xs = nodes
      .map((row) => layout.positions.get(row.id)?.x)
      .filter((value): value is number => typeof value === "number")
      .sort((a, b) => a - b);

    expect(xs.length).toBe(12);
    expect(xs[0]).toBeLessThan(LAYOUT.paddingX + LAYOUT.nodeWidth);
    expect(xs[xs.length - 1]).toBeGreaterThan(layout.width - LAYOUT.paddingX - LAYOUT.nodeWidth);
    expect(xs[xs.length - 1] - xs[0]).toBeGreaterThan(900);
  });

  it("fits more than four nodes on a row when the canvas is wide", () => {
    const nodes = Array.from({ length: 6 }, (_, index) => node(`module-${index}`));
    const layout = computeLayeredLayout(nodes, new Set(["layer:MODULE"]), 2200);
    const ys = new Set(
      nodes.map((row) => layout.positions.get(row.id)?.y).filter((value): value is number => typeof value === "number")
    );
    expect(ys.size).toBe(1);
    expect(nodesPerRowForWidth(2200)).toBeGreaterThan(4);
  });
});


describe("presentationEdgePath", () => {
  it("routes same-row relationships in the gutter below cards", () => {
    expect(presentationEdgePath({x:200,y:100},{x:600,y:100})).toBe("M 200 138 V 145 H 600 V 138");
  });
  it("uses the inter-row gutter for adjacent rows in the same section", () => {
    const bands = [{ bandKey: "shared", layer: "MODULE" as const, label: "Shared", y: 50, height: 300, count: 2, bandX: 104, bandWidth: 1200 }];
    expect(presentationEdgePath({x:200,y:150},{x:600,y:262}, 3, bands)).toBe("M 200 188 V 206 H 600 V 224");
    expect(presentationEdgePath({x:600,y:262},{x:200,y:150}, 3, bands)).toBe("M 600 224 V 206 H 200 V 188");
  });
  it("keeps cross-section vertical runs outside section headings", () => {
    const bands = [{ bandKey: "shared", layer: "MODULE" as const, label: "Shared", y: 50, height: 200, count: 2, bandX: 104, bandWidth: 1200 },
      { bandKey: "processes", layer: "WORKFLOW" as const, label: "Processes", y: 280, height: 200, count: 2, bandX: 104, bandWidth: 1200 }];
    const path = presentationEdgePath({x:200,y:150},{x:600,y:380}, 3, bands);
    expect(path).toBe("M 200 188 V 204 H 21 V 325 H 600 V 342");
    expect(presentationEdgePath({x:200,y:150},{x:600,y:380}, 4, bands)).not.toBe(path);
  });
});
