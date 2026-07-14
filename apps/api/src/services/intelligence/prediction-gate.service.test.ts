import { describe, expect, it } from "vitest";
import { newPredictionCandidateFields } from "./prediction-gate.service";
import { computeConfidence } from "./confidence.service";
import { PREDICTION_STATUS } from "./intelligence-constants";

describe("newPredictionCandidateFields", () => {
  it("stores candidates as DISABLED when predictions are off", () => {
    const confidence = computeConfidence({
      evidenceCount: 50,
      dataCompleteness: 1,
      historicalAccuracy: 0.95,
      matchingIncidents: 10,
      recoveryMatches: 8
    });
    const candidate = newPredictionCandidateFields({
      confidence,
      title: "Possible degradation",
      summary: "Scaffold only",
      predictionType: "DEGRADATION"
    });
    expect(candidate.status).toBe(PREDICTION_STATUS.DISABLED);
    expect(candidate.evidenceJson.gated).toBe(true);
  });
});
