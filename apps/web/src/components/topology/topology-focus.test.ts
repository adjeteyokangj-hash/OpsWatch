import { describe, expect, it } from "vitest";
import type { TopologyEdge } from "./topology-types";
import { collapsedGroupIdsForLargeTopology } from "./topology-focus";

const edge = (sourceId: string, targetId: string): TopologyEdge => ({
  id: `${sourceId}-${targetId}`,
  sourceId,
  targetId,
  type: "HIERARCHY",
  critical: false,
  status: "UNKNOWN"
});

describe("collapsed topology groups", () => {
  const edges = [
    edge("cloud", "app"),
    edge("auth", "cloud"),
    edge("properties", "app"),
    edge("kanewu", "properties")
  ];

  it("leaves a small map expanded", () => {
    expect(collapsedGroupIdsForLargeTopology(4, edges)).toEqual([]);
  });

  it("collapses nested groups and leaves the application visible", () => {
    expect(collapsedGroupIdsForLargeTopology(16, edges).sort()).toEqual(["cloud", "properties"]);
  });
});
