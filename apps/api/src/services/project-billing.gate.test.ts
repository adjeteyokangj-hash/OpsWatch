import { describe, expect, it, vi } from "vitest";

const { billingFindUnique } = vi.hoisted(() => ({ billingFindUnique: vi.fn() }));
vi.mock("../lib/prisma", () => ({
  prisma: { projectBilling: { findUnique: billingFindUnique } }
}));
import { PLAN_DEFAULTS, getProjectBilling, normalizeAllowanceLimit, resolvePricingLabel } from "./project-billing.service";

describe("project-billing production gate", () => {
  it("uses FREE defaults with finite limits", () => {
    const defaults = PLAN_DEFAULTS.FREE;
    expect(defaults.monthlyPrice).toBe(0);
    expect(defaults.checkLimit).toBe(10);
    expect(defaults.userLimit).toBe(2);
    expect(defaults.automationRunLimit).toBe(20);
  });

  it("uses null for ENTERPRISE unlimited allowances", () => {
    const defaults = PLAN_DEFAULTS.ENTERPRISE;
    expect(defaults.checkLimit).toBeNull();
    expect(defaults.userLimit).toBeNull();
    expect(defaults.automationRunLimit).toBeNull();
  });

  it("normalizes legacy 9999 sentinel to unlimited", () => {
    expect(normalizeAllowanceLimit(9999)).toBeNull();
    expect(normalizeAllowanceLimit(50)).toBe(50);
    expect(normalizeAllowanceLimit(null)).toBeNull();
  });

  it("marks custom pricing when limits deviate from plan defaults", () => {
    const label = resolvePricingLabel("FREE", {
      ...PLAN_DEFAULTS.FREE,
      checkLimit: 999
    });
    expect(label).toBe("CUSTOM");
  });

  it("getProjectBilling returns null for a missing project", async () => {
    billingFindUnique.mockResolvedValueOnce(null);
    const billing = await getProjectBilling("missing-project-id");
    expect(billing).toBeNull();
    expect(billingFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: "missing-project-id" }
    }));
  });
});
