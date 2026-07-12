import { describe, expect, it } from "vitest";
import { PLAN_DEFINITIONS, getPlanDefinition } from "./plan-definitions";
import { ENTITLEMENT } from "./entitlement-keys";

describe("plan-definitions", () => {
  it("defines launch plans with expected pricing", () => {
    expect(getPlanDefinition("PILOT").monthlyPrice).toBe(59);
    expect(getPlanDefinition("GROWTH").monthlyPrice).toBe(129);
    expect(getPlanDefinition("BUSINESS").monthlyPrice).toBe(349);
  });

  it("gates AI diagnosis to Growth and above", () => {
    const pilot = getPlanDefinition("PILOT").entitlements.find(
      (row) => row.featureKey === ENTITLEMENT.DIAGNOSIS_AI
    );
    const growth = getPlanDefinition("GROWTH").entitlements.find(
      (row) => row.featureKey === ENTITLEMENT.DIAGNOSIS_AI
    );
    expect(pilot?.enabled).toBe(false);
    expect(growth?.enabled).toBe(true);
  });

  it("includes all entitlement keys for every plan", () => {
    const requiredKeys = Object.values(ENTITLEMENT);
    for (const plan of PLAN_DEFINITIONS) {
      const keys = plan.entitlements.map((row) => row.featureKey);
      for (const key of requiredKeys) {
        expect(keys).toContain(key);
      }
    }
  });
});
