import { describe, expect, it } from "vitest";
import {
  canonicalEntityIdentityKey,
  canonicalProjectScopeKey,
  canonicalRelationshipIdentityKey,
  CanonicalGraphService,
  GraphIdentityConflictError
} from "@opswatch/shared";

describe("canonical graph identity", () => {
  it("normalizes entity identity deterministically", () => {
    expect(
      canonicalEntityIdentityKey({
        entityType: " app ",
        stableKey: "  Checkout   API "
      })
    ).toBe("app:checkout api");
    expect(
      canonicalEntityIdentityKey({
        entityType: "APP",
        stableKey: "Checkout API"
      })
    ).toBe("app:checkout api");
  });

  it("keeps relationship direction in the stable identity", () => {
    expect(
      canonicalRelationshipIdentityKey({
        sourceEntityId: "a",
        targetEntityId: "b",
        relationshipType: " Calls "
      })
    ).toBe("calls:a:b");
    expect(
      canonicalRelationshipIdentityKey({
        sourceEntityId: "b",
        targetEntityId: "a",
        relationshipType: "calls"
      })
    ).toBe("calls:b:a");
  });

  it("uses an empty project scope only for organization-shared entities", () => {
    expect(canonicalProjectScopeKey("project-1", "PROJECT")).toBe("project-1");
    expect(canonicalProjectScopeKey("project-1", "ORGANIZATION")).toBe("");
  });

  it("rejects project-scoped writes without a project", async () => {
    const service = new CanonicalGraphService({} as never);
    await expect(
      service.upsertEntity({
        organizationId: "org-1",
        environment: "production",
        entityType: "APP",
        stableKey: "checkout",
        name: "Checkout",
        source: "MANUAL",
        provenance: "MANUAL"
      })
    ).rejects.toBeInstanceOf(GraphIdentityConflictError);
  });
});
