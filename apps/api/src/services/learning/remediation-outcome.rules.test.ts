import { describe, expect, it } from "vitest";

/**
 * Pure recommendation-confidence rules used by remediation outcome learning.
 * Duplicated here so unit tests do not require Prisma.
 */
const recommendationConfidence = (input: {
  successCount: number;
  failureCount: number;
  partialCount: number;
  rollbackCount: number;
}): number => {
  const attempts =
    input.successCount + input.failureCount + input.partialCount + input.rollbackCount;
  const successRate = attempts === 0 ? 0 : input.successCount / attempts;
  if (input.successCount >= 2 && successRate >= 0.6) {
    return Math.min(
      0.85,
      0.4 + successRate * 0.4 + Math.min(0.2, input.successCount * 0.05)
    );
  }
  if (input.successCount === 1 && input.failureCount === 0) {
    return 0.25;
  }
  if (input.failureCount > input.successCount) {
    return Math.max(0.05, 0.3 - input.failureCount * 0.05);
  }
  return Math.min(0.45, successRate * 0.5);
};

describe("remediation outcome learning rules", () => {
  it("does not over-promote from a single success", () => {
    expect(
      recommendationConfidence({
        successCount: 1,
        failureCount: 0,
        partialCount: 0,
        rollbackCount: 0
      })
    ).toBe(0.25);
  });

  it("promotes after repeated verified successes", () => {
    const score = recommendationConfidence({
      successCount: 3,
      failureCount: 1,
      partialCount: 0,
      rollbackCount: 0
    });
    expect(score).toBeGreaterThanOrEqual(0.4);
  });

  it("reduces confidence after failures", () => {
    const score = recommendationConfidence({
      successCount: 0,
      failureCount: 3,
      partialCount: 0,
      rollbackCount: 1
    });
    expect(score).toBeLessThan(0.3);
  });
});
