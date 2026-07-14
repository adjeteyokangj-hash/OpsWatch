import { describe, expect, it } from "vitest";
import {
  assertRecommendationAllowed,
  computeConfidence
} from "./confidence.service";
import { evaluatePredictionGate } from "./prediction-gate.service";
import { PREDICTION_STATUS } from "./intelligence-constants";

describe("computeConfidence", () => {
  it("returns INSUFFICIENT with zero evidence", () => {
    const result = computeConfidence({ evidenceCount: 0, dataCompleteness: 0 });
    expect(result.label).toBe("INSUFFICIENT");
    expect(result.displayEligible).toBe(false);
    expect(result.recommendationEligible).toBe(false);
    expect(result.score).toBe(0);
  });

  it("raises score with evidence and completeness", () => {
    const low = computeConfidence({ evidenceCount: 2, dataCompleteness: 0.2 });
    const high = computeConfidence({
      evidenceCount: 40,
      dataCompleteness: 0.95,
      historicalAccuracy: 0.9,
      matchingIncidents: 8,
      recoveryMatches: 5
    });
    expect(high.score).toBeGreaterThan(low.score);
    expect(high.recommendationEligible).toBe(true);
  });

  it("blocks recommendations without eligibility", () => {
    const blocked = assertRecommendationAllowed(
      computeConfidence({ evidenceCount: 0, dataCompleteness: 0 })
    );
    expect(blocked.allowed).toBe(false);
  });
});

describe("evaluatePredictionGate", () => {
  it("keeps predictions disabled when flag is off", () => {
    delete process.env.OPSWATCH_PREDICTIONS_ENABLED;
    const confidence = computeConfidence({
      evidenceCount: 100,
      dataCompleteness: 1,
      historicalAccuracy: 1,
      matchingIncidents: 20,
      recoveryMatches: 20
    });
    const gate = evaluatePredictionGate(confidence);
    expect(gate.status).toBe(PREDICTION_STATUS.DISABLED);
    expect(gate.emitToProduct).toBe(false);
  });
});
