import { describe, expect, it } from "vitest";
import { TOPOLOGY_KEY_ENTRIES, HIERARCHY_EDGE_COLOR } from "../../../../components/topology/topology-edge-style";

/**
 * Guard: every colour class used when painting edges must have a Topology key entry.
 * Purple (#9F7AEA) must not be a relationship-line colour.
 */
describe("topology line colour coverage", () => {
  it("keeps hierarchy stroke on documented grey", () => {
    expect(HIERARCHY_EDGE_COLOR.toLowerCase()).toBe("#94a3b8");
    expect(HIERARCHY_EDGE_COLOR.toLowerCase()).not.toBe("#9f7aea");
  });

  it("has a legend entry for each dependency health tone", () => {
    const required = ["healthy", "degraded", "critical", "unknown", "hierarchy", "dependency"];
    for (const id of required) {
      expect(TOPOLOGY_KEY_ENTRIES.some((entry) => entry.id === id)).toBe(true);
    }
  });
});
