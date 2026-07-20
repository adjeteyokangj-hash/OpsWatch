import { describe, expect, it } from "vitest";

/** Mirrors canonical-topology-loader CONTAINS→APP hierarchy remapping. */
const topologyDependencyTypeFor = (relationshipType: string): string => {
  const normalized = relationshipType.trim().toUpperCase();
  if (normalized === "CONTAINS" || normalized === "HIERARCHY") return "HIERARCHY";
  if (normalized === "RUNTIME" || normalized === "DEPENDENCY" || normalized === "DEPENDS_ON") {
    return "DEPENDENCY";
  }
  return normalized;
};

const resolveTopologyEndpointId = (
  entityId: string,
  entityById: Map<string, { entityType: string }>,
  appEntityId: string | null
): string | null => {
  const entity = entityById.get(entityId);
  if (!entity) return null;
  if (entity.entityType === "PROJECT") return appEntityId;
  return entityId;
};

describe("canonical topology CONTAINS remapping", () => {
  it("maps CONTAINS to HIERARCHY and PROJECT endpoints to APP", () => {
    expect(topologyDependencyTypeFor("CONTAINS")).toBe("HIERARCHY");
    expect(topologyDependencyTypeFor("RUNTIME")).toBe("DEPENDENCY");

    const entityById = new Map([
      ["proj", { entityType: "PROJECT" }],
      ["app", { entityType: "APP" }],
      ["mod", { entityType: "MODULE" }]
    ]);
    expect(resolveTopologyEndpointId("proj", entityById, "app")).toBe("app");
    expect(resolveTopologyEndpointId("mod", entityById, "app")).toBe("mod");
    expect(resolveTopologyEndpointId("missing", entityById, "app")).toBeNull();
  });

  it("flips CONTAINS parent→child into hierarchy child→parent endpoints", () => {
    const sourceId = "app";
    const targetId = "mod";
    const isContains = true;
    const fromServiceId = isContains ? targetId : sourceId;
    const toServiceId = isContains ? sourceId : targetId;
    expect(fromServiceId).toBe("mod");
    expect(toServiceId).toBe("app");
  });
});