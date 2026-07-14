import { afterEach, describe, expect, it } from "vitest";
import { evaluatePredictionGate, newPredictionCandidateFields } from "./prediction-gate.service";
import { computeConfidence } from "./confidence.service";
import { PREDICTION_STATUS } from "./intelligence-constants";

const highConfidence = () =>
  computeConfidence({
    evidenceCount: 50,
    dataCompleteness: 1,
    historicalAccuracy: 0.95,
    matchingIncidents: 10,
    recoveryMatches: 8
  });

const lowConfidence = () =>
  computeConfidence({
    evidenceCount: 2,
    dataCompleteness: 0.2
  });

afterEach(() => {
  delete process.env.OPSWATCH_PREDICTIONS_ENABLED;
});

describe("newPredictionCandidateFields", () => {
  it("stores candidates as DISABLED when predictions are off", () => {
    process.env.OPSWATCH_PREDICTIONS_ENABLED = "false";
    const candidate = newPredictionCandidateFields({
      confidence: highConfidence(),
      title: "Possible degradation",
      summary: "Scaffold only",
      predictionType: "DEGRADATION"
    });
    expect(candidate.status).toBe(PREDICTION_STATUS.DISABLED);
    expect(candidate.evidenceJson.gated).toBe(true);
  });
});

describe("evaluatePredictionGate", () => {
  it("keeps predictions disabled when OPSWATCH_PREDICTIONS_ENABLED=false", () => {
    process.env.OPSWATCH_PREDICTIONS_ENABLED = "false";
    const gate = evaluatePredictionGate(highConfidence());
    expect(gate.enabled).toBe(false);
    expect(gate.status).toBe(PREDICTION_STATUS.DISABLED);
    expect(gate.emitToProduct).toBe(false);
    expect(gate.reason).toMatch(/disabled/i);
  });

  it("keeps predictions disabled when flag is unset", () => {
    delete process.env.OPSWATCH_PREDICTIONS_ENABLED;
    const gate = evaluatePredictionGate(highConfidence());
    expect(gate.enabled).toBe(false);
    expect(gate.status).toBe(PREDICTION_STATUS.DISABLED);
    expect(gate.emitToProduct).toBe(false);
  });

  it("blocks product emission with insufficient confidence when flag is on", () => {
    process.env.OPSWATCH_PREDICTIONS_ENABLED = "true";
    const gate = evaluatePredictionGate(lowConfidence());
    expect(gate.enabled).toBe(true);
    expect(gate.status).toBe(PREDICTION_STATUS.INSUFFICIENT_DATA);
    expect(gate.emitToProduct).toBe(false);
    expect(gate.reason).toMatch(/below the release threshold/i);
  });

  it("allows product emission only when flag is on and confidence meets threshold", () => {
    process.env.OPSWATCH_PREDICTIONS_ENABLED = "true";
    const gate = evaluatePredictionGate(highConfidence());
    expect(gate.enabled).toBe(true);
    expect(gate.status).toBe(PREDICTION_STATUS.READY);
    expect(gate.emitToProduct).toBe(true);
  });

  it("does not enable autonomous prevention when predictions are off", () => {
    process.env.OPSWATCH_PREDICTIONS_ENABLED = "false";
    const gate = evaluatePredictionGate(highConfidence());
    expect(gate.emitToProduct).toBe(false);
    expect(gate.status).not.toBe(PREDICTION_STATUS.READY);
  });
});
