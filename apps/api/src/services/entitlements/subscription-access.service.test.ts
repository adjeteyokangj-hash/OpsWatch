import { describe, expect, it } from "vitest";
import { resolveSubscriptionAccess } from "./subscription-access.service";

describe("subscription-access.service", () => {
  const future = new Date("2027-01-01T00:00:00.000Z");
  const past = new Date("2025-01-01T00:00:00.000Z");

  it("returns default pilot access when subscription is missing", () => {
    const access = resolveSubscriptionAccess({ subscription: null, planCode: "GROWTH" });
    expect(access.mode).toBe("DEFAULT");
    expect(access.effectivePlanCode).toBe("PILOT");
    expect(access.allowMutations).toBe(true);
  });

  it("allows full access for active subscriptions", () => {
    const access = resolveSubscriptionAccess({
      subscription: { status: "ACTIVE", cancelAtPeriodEnd: false, currentPeriodEnd: future, planId: "x" },
      planCode: "GROWTH"
    });
    expect(access.mode).toBe("FULL");
    expect(access.allowMutations).toBe(true);
  });

  it("keeps grace access for past due subscriptions", () => {
    const access = resolveSubscriptionAccess({
      subscription: { status: "PAST_DUE", cancelAtPeriodEnd: false, currentPeriodEnd: future, planId: "x" },
      planCode: "GROWTH"
    });
    expect(access.mode).toBe("GRACE");
    expect(access.allowMutations).toBe(true);
    expect(access.billingWarning).toMatch(/past due/i);
  });

  it("restricts unpaid subscriptions to read-only", () => {
    const access = resolveSubscriptionAccess({
      subscription: { status: "UNPAID", cancelAtPeriodEnd: false, currentPeriodEnd: future, planId: "x" },
      planCode: "GROWTH"
    });
    expect(access.mode).toBe("READ_ONLY");
    expect(access.allowMutations).toBe(false);
    expect(access.allowMonitoringExecution).toBe(false);
  });

  it("allows access until period end when cancelled at period end", () => {
    const access = resolveSubscriptionAccess({
      subscription: { status: "CANCELLED", cancelAtPeriodEnd: true, currentPeriodEnd: future, planId: "x" },
      planCode: "BUSINESS",
      now: new Date("2026-07-01T00:00:00.000Z")
    });
    expect(access.mode).toBe("PERIOD_END");
    expect(access.effectivePlanCode).toBe("BUSINESS");
  });

  it("downgrades after cancellation period ends", () => {
    const access = resolveSubscriptionAccess({
      subscription: { status: "CANCELLED", cancelAtPeriodEnd: true, currentPeriodEnd: past, planId: "x" },
      planCode: "BUSINESS",
      now: new Date("2026-07-01T00:00:00.000Z")
    });
    expect(access.mode).toBe("RESTRICTED");
    expect(access.effectivePlanCode).toBe("PILOT");
  });
});
