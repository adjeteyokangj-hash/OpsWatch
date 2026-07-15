import { describe, expect, it } from "vitest";
import { computeErrorBudget } from "./controlled-automation.service";
import { ownershipFromBody } from "./ownership.service";

describe("ownership.service (phase 7)", () => {
  it("normalizes ownership body fields", () => {
    expect(
      ownershipFromBody({
        ownerUserId: "  user-1  ",
        ownerTeam: " payments ",
        runbookUrl: "https://example.test/runbooks/checkout",
        escalationContact: " "
      })
    ).toEqual({
      ownerUserId: "user-1",
      ownerTeam: "payments",
      runbookUrl: "https://example.test/runbooks/checkout",
      escalationContact: null
    });
  });

  it("computes empty error budget when availability is missing", () => {
    const snap = computeErrorBudget({
      targetPct: 99.5,
      availabilityPct: null,
      burnRate: null,
      status: "UNKNOWN"
    });
    expect(snap.errorBudgetRemainingPct).toBeNull();
  });
});
