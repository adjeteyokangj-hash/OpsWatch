import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ plan: { upsert: vi.fn(), findUniqueOrThrow: vi.fn() }, planEntitlement: { upsert: vi.fn() } }));
vi.mock("../../lib/prisma", () => ({ prisma: db }));
import { seedPlans } from "./subscription.service";
import { PLAN_DEFINITIONS } from "./plan-definitions";

beforeEach(() => {
  db.plan.upsert.mockResolvedValue({});
  db.plan.findUniqueOrThrow.mockResolvedValue({ id: "fixture-plan" });
  db.planEntitlement.upsert.mockResolvedValue({});
});
describe("concurrent first-request plan seeding", () => {
  it("recovers a committed plan and entitlement winner without changing definitions", async () => {
    db.plan.upsert.mockRejectedValueOnce({ code: "P2002" });
    db.planEntitlement.upsert.mockRejectedValueOnce({ code: "P2002" });
    await seedPlans();
    expect(db.plan.upsert).toHaveBeenCalledTimes(PLAN_DEFINITIONS.length + 1);
    const [first, retried] = db.plan.upsert.mock.calls.map(call => call[0]);
    expect(retried).toMatchObject({ where: first.where, create: { code: first.create.code, name: first.create.name,
      monthlyPrice: first.create.monthlyPrice, annualPrice: first.create.annualPrice } });
    expect(db.planEntitlement.upsert.mock.calls[0][0].where).toEqual(db.planEntitlement.upsert.mock.calls[1][0].where);
    expect(db.planEntitlement.upsert.mock.calls[0][0].update).toEqual(db.planEntitlement.upsert.mock.calls[1][0].update);
  });
  it("propagates database outages and persistent conflicts", async () => {
    db.plan.upsert.mockRejectedValueOnce({ code: "P1001" });
    await expect(seedPlans()).rejects.toEqual({ code: "P1001" });
    db.plan.upsert.mockRejectedValue({ code: "P2002" });
    await expect(seedPlans()).rejects.toEqual({ code: "P2002" });
  });
});
