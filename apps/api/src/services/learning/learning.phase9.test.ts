import { afterEach, describe, expect, it } from "vitest";
import {
  computeSampleStats,
  confidenceFromSamples,
  isTestOrFixtureProject
} from "./learning-stats";
import { evaluateAnomalyMethods } from "./anomaly-detection.service";
import { sustainedRisingTrend } from "./deterioration.service";
import { buildIncidentFingerprint } from "./incident-pattern.service";
import {
  isLearningStageEnabled,
  isPredictionGenerationEnabled,
  listLearningStages,
  MIN_BASELINE_SAMPLES_PHASE9
} from "./learning-flags";

afterEach(() => {
  delete process.env.OPSWATCH_PREDICTIONS_ENABLED;
  delete process.env.OPSWATCH_LEARNING_BASELINES_ENABLED;
  delete process.env.OPSWATCH_LEARNING_ANOMALIES_ENABLED;
  delete process.env.OPSWATCH_LEARNING_INCIDENT_MATCHING_ENABLED;
  delete process.env.OPSWATCH_PREDICTION_NOTIFICATIONS_ENABLED;
  delete process.env.OPSWATCH_PREVENTIVE_RECOMMENDATIONS_ENABLED;
});

describe("learning-stats", () => {
  it("computes sample stats and requires minimum samples for confidence", () => {
    const empty = computeSampleStats([]);
    expect(empty.sampleCount).toBe(0);
    expect(empty.mean).toBeNull();

    const stats = computeSampleStats([10, 20, 30, 40, 50]);
    expect(stats.mean).toBe(30);
    expect(stats.minValue).toBe(10);
    expect(stats.maxValue).toBe(50);

    const low = confidenceFromSamples(3);
    expect(low.label).toBe("INSUFFICIENT");
    const high = confidenceFromSamples(MIN_BASELINE_SAMPLES_PHASE9 * 4, 1);
    expect(high.label).toBe("HIGH");
  });

  it("excludes fixture/demo/seeded projects", () => {
    expect(isTestOrFixtureProject({ slug: "demo-app" })).toBe(true);
    expect(isTestOrFixtureProject({ name: "SEEDED_TEST" })).toBe(true);
    expect(isTestOrFixtureProject({ slug: "payments-prod", environment: "production" })).toBe(
      false
    );
  });
});

describe("anomaly methods", () => {
  it("detects rolling and percentile deviation", () => {
    const hits = evaluateAnomalyMethods({
      baselineMean: 100,
      baselineP95: 120,
      variance: 25,
      observed: 200,
      sampleCount: 20
    });
    expect(hits.some((row) => row.method === "ROLLING_DEVIATION")).toBe(true);
    expect(hits.some((row) => row.method === "PERCENTILE_DEVIATION")).toBe(true);
    expect(hits[0]?.explanation).toMatch(/not a prediction/i);
  });

  it("suppresses false positives near baseline", () => {
    const hits = evaluateAnomalyMethods({
      baselineMean: 100,
      baselineP95: 110,
      variance: 4,
      observed: 102,
      sampleCount: 20
    });
    expect(hits).toHaveLength(0);
  });
});

describe("deterioration", () => {
  it("requires sustained rising trend", () => {
    expect(sustainedRisingTrend([1, 1.2, 1.4, 1.6, 1.8])).not.toBeNull();
    expect(sustainedRisingTrend([1, 2, 1, 2, 1])).toBeNull();
    expect(sustainedRisingTrend([1, 1.01])).toBeNull();
  });
});

describe("incident fingerprint", () => {
  it("is stable for same inputs", () => {
    const a = buildIncidentFingerprint({
      category: "availability",
      rootCause: "DB pool exhausted",
      affectedServiceIds: ["b", "a"]
    });
    const b = buildIncidentFingerprint({
      category: "availability",
      rootCause: "DB pool exhausted",
      affectedServiceIds: ["a", "b"]
    });
    expect(a).toBe(b);
  });
});

describe("learning stage flags", () => {
  it("defaults all stages off including predictions", () => {
    const stages = listLearningStages();
    expect(stages.every((stage) => stage.defaultEnabled === false)).toBe(true);
    expect(stages.every((stage) => stage.enabled === false)).toBe(true);
    expect(isPredictionGenerationEnabled()).toBe(false);
    expect(isLearningStageEnabled("BASELINE_CALCULATION")).toBe(false);
  });

  it("enables only when env is exactly true", () => {
    process.env.OPSWATCH_LEARNING_BASELINES_ENABLED = "true";
    process.env.OPSWATCH_PREDICTIONS_ENABLED = "true";
    expect(isLearningStageEnabled("BASELINE_CALCULATION")).toBe(true);
    expect(isPredictionGenerationEnabled()).toBe(true);
  });
});
