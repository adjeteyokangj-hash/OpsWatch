import { describe, expect, it } from "vitest";
import { hasFreshActiveMonitoring } from "./product-insights.controller";
describe("coverage requires active monitoring evidence", () => {
  const now = new Date("2026-10-23T10:00:00Z").getTime();
  it("does not count configured checks, inactive checks or tracked gaps", () => {
    expect(hasFreshActiveMonitoring({ isActive: true }, now)).toBe(false);
    expect(hasFreshActiveMonitoring({ isActive: false, results: [{ checkedAt: new Date(now) }] }, now)).toBe(false);
    expect(hasFreshActiveMonitoring({ coverageSource: "GAP" }, now)).toBe(false);
  });
  it("counts a recent executed check even when the monitored service is down", () => {
    expect(hasFreshActiveMonitoring({ isActive: true, intervalSeconds: 60, results: [{ checkedAt: new Date(now - 60_000), status: "FAIL" }] }, now)).toBe(true);
  });
  it("excludes stale or future evidence", () => {
    expect(hasFreshActiveMonitoring({ isActive: true, results: [{ checkedAt: new Date(now - 86_400_000) }] }, now)).toBe(false);
    expect(hasFreshActiveMonitoring({ isActive: true, results: [{ checkedAt: new Date(now + 60_000) }] }, now)).toBe(false);
  });
});
