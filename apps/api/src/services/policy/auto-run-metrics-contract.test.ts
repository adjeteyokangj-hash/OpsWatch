import { describe, expect, it } from "vitest";

describe("auto-run metrics denominator contract", () => {
  it("documents executed-only success rate formula", () => {
    const succeeded = 10;
    const failed = 2;
    const blockedOrPendingApproval = 50;
    const attempted = succeeded + failed + blockedOrPendingApproval;
    const executed = succeeded + failed;
    const successRate = executed === 0 ? 0 : succeeded / executed;
    expect(attempted).toBe(62);
    expect(executed).toBe(12);
    expect(successRate).toBeCloseTo(10 / 12);
    expect(successRate).not.toBe(0);
  });
});
