import { describe, expect, it } from "vitest";
import { computeLayeredLayout, LAYOUT, nodesPerRowForWidth } from "./topology-layout";
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
