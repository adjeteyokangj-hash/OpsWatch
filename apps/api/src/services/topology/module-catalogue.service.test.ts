import { describe, expect, it } from "vitest";
import { CORE_MODULE_CATALOGUE, proposeProjectModules } from "./module-catalogue.service";

describe("project module catalogue proposals", () => {
  it("keeps unrelated project modules isolated", () => {
    const guestHouse = proposeProjectModules({ description: "Guest house rooms, bookings and cash reconciliation" });
    const game = proposeProjectModules({ description: "Oware game engine and two-player gameplay" });
    expect(guestHouse.map((row) => row.key)).toContain("bookings");
    expect(guestHouse.map((row) => row.key)).not.toContain("games");
    expect(game.map((row) => row.key)).toContain("games");
    expect(game.map((row) => row.key)).not.toContain("bookings");
  });
  it("never turns unverified description into verified evidence", () => {
    expect(proposeProjectModules({ description: "Payments" })[0]).toMatchObject({
      key: "payments", state: "inferred", requiresApproval: true
    });
  });
  it("requires authorised verified API evidence to label verified", () => {
    expect(proposeProjectModules({ connectedApi: { verified: false, capabilities: ["payments"] } })[0].state).toBe("suggested");
    expect(proposeProjectModules({ connectedApi: { verified: true, capabilities: ["payments"] } })[0].state).toBe("verified");
  });
  it("supports project-only extensions without mutating core catalogue", () => {
    const before = CORE_MODULE_CATALOGUE.length;
    expect(proposeProjectModules({ description: "specialist inventory", extensions: [{ key: "inventory", label: "Inventory", terms: ["inventory"] }] }).map((row) => row.key)).toContain("inventory");
    expect(proposeProjectModules({ description: "specialist inventory" }).map((row) => row.key)).not.toContain("inventory");
    expect(CORE_MODULE_CATALOGUE).toHaveLength(before);
  });
  it("matches complete terms rather than substrings", () => {
    expect(proposeProjectModules({ description: "staffing" }).map((row) => row.key)).not.toContain("identity");
    expect(proposeProjectModules({ description: "workflow approvals" }).map((row) => row.key)).toContain("tasks");
  });
  it("does not invent a module without matching evidence", () => {
    expect(proposeProjectModules({ publicUrl: "https://example.org" })).toEqual([]);
  });
});
