import { afterEach, describe, expect, it } from "vitest";
import {
  assertAllLearningGatesDefaultOff,
  isFeatureGateEnabled,
  listFeatureGates
} from "./feature-gates.service";
import {
  assessOperationalRisk,
  buildGatedPredictionDraft
} from "./learning-prediction.service";
import { computeConfidence } from "./confidence.service";
import { PREDICTION_STATUS } from "./intelligence-constants";

describe("phase 8 feature gates + learning/prediction framework", () => {
  const gateEnvVars = [
    "OPSWATCH_PREDICTIONS_ENABLED",
    "OPSWATCH_LEARNED_TOPOLOGY_ENABLED",
    "OPSWATCH_OTEL_INGESTION_ENABLED",
    "OPSWATCH_AUTO_REPAIR_ENABLED",
    "OPSWATCH_ADVANCED_RCA_ENABLED",
    "OPSWATCH_AUTOMATION_TEST_MODE"
  ] as const;

  const snapshots = new Map<string, string | undefined>();

  afterEach(() => {
    for (const key of gateEnvVars) {
      const previous = snapshots.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    snapshots.clear();
  });

  const clearGates = () => {
    for (const key of gateEnvVars) {
      snapshots.set(key, process.env[key]);
      delete process.env[key];
    }
  };

  it("defaults every learning/prediction related gate to OFF", () => {
    clearGates();
    const gates = listFeatureGates();
    expect(gates.every((g) => g.defaultEnabled === false)).toBe(true);
    expect(assertAllLearningGatesDefaultOff(gates)).toEqual({ ok: true, enabled: [] });
    expect(isFeatureGateEnabled("PREDICTIONS")).toBe(false);
    expect(isFeatureGateEnabled("LEARNED_TOPOLOGY")).toBe(false);
    expect(isFeatureGateEnabled("OTEL_INGESTION")).toBe(false);
    expect(isFeatureGateEnabled("AUTO_REPAIR")).toBe(false);
    expect(isFeatureGateEnabled("ADVANCED_RCA")).toBe(false);
  });

  it("does not emit prediction drafts while predictions remain disabled", () => {
    clearGates();
    const confidence = computeConfidence({
      evidenceCount: 20,
      historicalAccuracy: 0.9,
      matchingIncidents: 5,
      recoveryMatches: 4,
      dataCompleteness: 1
    });
    const draft = buildGatedPredictionDraft({
      title: "Sample",
      summary: "Should stay disabled",
      predictionType: "RISK_TRAJECTORY",
      confidence
    });
    expect(draft.status).toBe(PREDICTION_STATUS.DISABLED);
    expect(draft.emitToProduct).toBe(false);
  });

  it("scores risk only when sample counts are sufficient and never auto-emits", () => {
    clearGates();
    const insufficient = assessOperationalRisk({
      organizationId: "org",
      scopeType: "SERVICE",
      scopeKey: "checkout",
      sampleCount: 2,
      failureRate: 0.5
    });
    expect(insufficient.label).toBe("INSUFFICIENT");
    expect(insufficient.emitToProduct).toBe(false);

    const scored = assessOperationalRisk({
      organizationId: "org",
      scopeType: "SERVICE",
      scopeKey: "checkout",
      sampleCount: 12,
      failureRate: 0.2,
      burnRate: 3
    });
    expect(scored.label).not.toBe("INSUFFICIENT");
    expect(scored.emitToProduct).toBe(false);
    expect(scored.riskScore).toBeGreaterThan(0);
  });
});
