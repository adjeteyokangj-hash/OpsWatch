/**
 * Phase 9 learning / prediction stage flags.
 * Default OFF under safety_gated; ai_led_safe profile enables the documented set
 * unless an individual flag is explicitly "false".
 */

import { resolveEffectiveEnvFlag } from "../intelligence/ai-operating-profile.service";

export type LearningStageKey =
  | "BASELINE_CALCULATION"
  | "ANOMALY_DETECTION"
  | "INCIDENT_MATCHING"
  | "PREDICTION_CANDIDATES"
  | "PREDICTION_NOTIFICATIONS"
  | "PREVENTIVE_RECOMMENDATIONS";

export type LearningStageStatus = {
  key: LearningStageKey;
  envVar: string;
  enabled: boolean;
  defaultEnabled: false;
  description: string;
};

export const listLearningStages = (): LearningStageStatus[] => [
  {
    key: "BASELINE_CALCULATION",
    envVar: "OPSWATCH_LEARNING_BASELINES_ENABLED",
    enabled: resolveEffectiveEnvFlag("OPSWATCH_LEARNING_BASELINES_ENABLED"),
    defaultEnabled: false,
    description: "Calculate behaviour baselines from live operational evidence"
  },
  {
    key: "ANOMALY_DETECTION",
    envVar: "OPSWATCH_LEARNING_ANOMALIES_ENABLED",
    enabled: resolveEffectiveEnvFlag("OPSWATCH_LEARNING_ANOMALIES_ENABLED"),
    defaultEnabled: false,
    description: "Deterministic anomaly detection against baselines"
  },
  {
    key: "INCIDENT_MATCHING",
    envVar: "OPSWATCH_LEARNING_INCIDENT_MATCHING_ENABLED",
    enabled: resolveEffectiveEnvFlag("OPSWATCH_LEARNING_INCIDENT_MATCHING_ENABLED"),
    defaultEnabled: false,
    description: "Similar-incident matching and pattern memory"
  },
  {
    key: "PREDICTION_CANDIDATES",
    envVar: "OPSWATCH_PREDICTIONS_ENABLED",
    enabled: resolveEffectiveEnvFlag("OPSWATCH_PREDICTIONS_ENABLED"),
    defaultEnabled: false,
    description: "Generate evidence-backed prediction candidates (gated by profile + confidence)"
  },
  {
    key: "PREDICTION_NOTIFICATIONS",
    envVar: "OPSWATCH_PREDICTION_NOTIFICATIONS_ENABLED",
    enabled: resolveEffectiveEnvFlag("OPSWATCH_PREDICTION_NOTIFICATIONS_ENABLED"),
    defaultEnabled: false,
    description: "Notify on confirmed high-impact prediction candidates"
  },
  {
    key: "PREVENTIVE_RECOMMENDATIONS",
    envVar: "OPSWATCH_PREVENTIVE_RECOMMENDATIONS_ENABLED",
    enabled: resolveEffectiveEnvFlag("OPSWATCH_PREVENTIVE_RECOMMENDATIONS_ENABLED"),
    defaultEnabled: false,
    description: "Surface low-risk preventive recommendations via Phase 7 registry"
  }
];

export const isLearningStageEnabled = (key: LearningStageKey): boolean =>
  listLearningStages().some((stage) => stage.key === key && stage.enabled);

/** Predictions product emission — default off; requires explicit env true. */
export const isPredictionGenerationEnabled = (): boolean =>
  isLearningStageEnabled("PREDICTION_CANDIDATES");

export const DATA_QUALITY = {
  LIVE: "LIVE",
  PARTIAL: "PARTIAL",
  INSUFFICIENT_SAMPLES: "INSUFFICIENT_SAMPLES",
  STALE: "STALE",
  TEST_EXCLUDED: "TEST_EXCLUDED",
  FIXTURE_EXCLUDED: "FIXTURE_EXCLUDED",
  UNKNOWN: "UNKNOWN"
} as const;

export type DataQualityState = (typeof DATA_QUALITY)[keyof typeof DATA_QUALITY];

export const PREDICTION_REVIEW_STATE = {
  DRAFT: "DRAFT",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  CONFIRMED: "CONFIRMED",
  DISMISSED: "DISMISSED",
  EXPIRED: "EXPIRED",
  MATERIALISED: "MATERIALISED",
  PREVENTED: "PREVENTED",
  FALSE_POSITIVE: "FALSE_POSITIVE"
} as const;

export const CONFIDENCE_LEVEL = {
  LOW: "LOW",
  MODERATE: "MODERATE",
  HIGH: "HIGH",
  INSUFFICIENT: "INSUFFICIENT"
} as const;

export const MIN_BASELINE_SAMPLES_PHASE9 = Number(
  process.env.OPSWATCH_MIN_BASELINE_SAMPLES ?? "12"
);

export const MIN_DETERIORATION_WINDOWS = Number(
  process.env.OPSWATCH_MIN_DETERIORATION_WINDOWS ?? "3"
);

export const ALGORITHM = {
  METRIC_BASELINE: "metric-baseline-v1",
  ANOMALY: "anomaly-v1",
  INCIDENT_PATTERN: "incident-pattern-v1",
  SIMILARITY: "incident-similarity-v1",
  PREDICTION: "prediction-candidate-v1",
  REMEDIATION_OUTCOME: "remediation-outcome-v1"
} as const;
