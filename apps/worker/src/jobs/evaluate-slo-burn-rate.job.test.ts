import { describe, expect, it } from "vitest";
import { calculateSloEvaluation } from "./evaluate-slo-burn-rate.job";

const definition = { sliType: "AVAILABILITY", targetPct: 99, latencyThresholdMs: null };
describe("SLO evaluation", () => {
  it("counts good and failed events and consumes error budget", () => {
    const result = calculateSloEvaluation([{ status: "PASS", responseTimeMs: 100 }, { status: "PASS", responseTimeMs: 120 }, { status: "FAIL", responseTimeMs: 500 }], definition)!;
    expect(result.availabilityPct).toBe(66.67); expect(result.errorRatePct).toBe(33.33); expect(result.burnRate).toBe(33.33); expect(result.status).toBe("BREACHING");
  });
  it("returns healthy compliance for good events", () => {
    const result = calculateSloEvaluation(Array.from({ length: 100 }, () => ({ status: "PASS", responseTimeMs: 50 })), definition)!;
    expect(result.availabilityPct).toBe(100); expect(result.burnRate).toBe(0); expect(result.status).toBe("HEALTHY");
  });
  it("evaluates latency against its threshold and calculates p95", () => {
    const result = calculateSloEvaluation([{ status: "PASS", responseTimeMs: 100 }, { status: "PASS", responseTimeMs: 600 }], { sliType: "LATENCY", targetPct: 90, latencyThresholdMs: 500 })!;
    expect(result.availabilityPct).toBe(50); expect(result.p95LatencyMs).toBe(600); expect(result.status).toBe("BREACHING");
  });
  it("does not fabricate an evaluation for an empty window", () => expect(calculateSloEvaluation([], definition)).toBeNull());
});
