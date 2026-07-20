/**
 * Intelligence foundation constants.
 * Phase 9: prediction product emission is gated by OPSWATCH_PREDICTIONS_ENABLED
 * (default off). Other learning stages use separate env flags.
 */

import { isPredictionGenerationEnabled } from "../learning/learning-flags";

export const isPredictionsEnabled = (): boolean => isPredictionGenerationEnabled();

/** Patterns / insights must meet this before UI may show them as actionable. */
export const MIN_DISPLAY_CONFIDENCE = Number(
  process.env.OPSWATCH_MIN_DISPLAY_CONFIDENCE ?? "0.7"
);

/** Recommendations require at least this confidence (no recommendation without confidence). */
export const MIN_RECOMMENDATION_CONFIDENCE = Number(
  process.env.OPSWATCH_MIN_RECOMMENDATION_CONFIDENCE ?? "0.6"
);

/** Predictions (when enabled) require higher bar. */
export const MIN_PREDICTION_CONFIDENCE = Number(
  process.env.OPSWATCH_MIN_PREDICTION_CONFIDENCE ?? "0.85"
);

/** Minimum evidence samples before a baseline is considered usable. */
export const MIN_BASELINE_SAMPLES = Number(
  process.env.OPSWATCH_MIN_BASELINE_SAMPLES ?? "5"
);

export const OBSERVATION_SOURCE = {
  HEARTBEAT: "HEARTBEAT",
  HEALTH_CHECK: "HEALTH_CHECK",
  ALERT: "ALERT",
  INCIDENT: "INCIDENT",
  DEPLOYMENT: "DEPLOYMENT",
  TOPOLOGY_CHANGE: "TOPOLOGY_CHANGE",
  WORKFLOW: "WORKFLOW",
  AUTOMATION: "AUTOMATION",
  DEPENDENCY: "DEPENDENCY",
  METRIC: "METRIC",
  SERVICE: "SERVICE",
  BASELINE: "BASELINE"
} as const;

export type ObservationSource =
  (typeof OBSERVATION_SOURCE)[keyof typeof OBSERVATION_SOURCE];

export const TIMELINE_EVENT = {
  HEARTBEAT_RECEIVED: "HEARTBEAT_RECEIVED",
  HEARTBEAT_LOST: "HEARTBEAT_LOST",
  DEPLOYMENT: "DEPLOYMENT",
  DEPENDENCY_DISCOVERED: "DEPENDENCY_DISCOVERED",
  SERVICE_REGISTERED: "SERVICE_REGISTERED",
  ALERT: "ALERT",
  INCIDENT: "INCIDENT",
  AUTOMATION_EXECUTED: "AUTOMATION_EXECUTED",
  RECOVERY_VERIFIED: "RECOVERY_VERIFIED",
  TOPOLOGY_UPDATED: "TOPOLOGY_UPDATED",
  BASELINE_UPDATED: "BASELINE_UPDATED"
} as const;

export type TimelineEventType =
  (typeof TIMELINE_EVENT)[keyof typeof TIMELINE_EVENT];

export const PATTERN_TYPE = {
  REPEATED_FAILURE: "REPEATED_FAILURE",
  RECOVERY_ACTION: "RECOVERY_ACTION",
  DEPLOY_CORRELATION: "DEPLOY_CORRELATION",
  RECURRING_DEGRADATION: "RECURRING_DEGRADATION",
  DEPENDENCY_FAILURE: "DEPENDENCY_FAILURE",
  RESOURCE_GROWTH: "RESOURCE_GROWTH"
} as const;

export type PatternType = (typeof PATTERN_TYPE)[keyof typeof PATTERN_TYPE];

export const CONFIDENCE_LABEL = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
  INSUFFICIENT: "INSUFFICIENT"
} as const;

export type ConfidenceLabel =
  (typeof CONFIDENCE_LABEL)[keyof typeof CONFIDENCE_LABEL];

export const PREDICTION_STATUS = {
  DISABLED: "DISABLED",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  READY: "READY"
} as const;

export type PredictionStatus =
  (typeof PREDICTION_STATUS)[keyof typeof PREDICTION_STATUS];

export const AI_DECISION_TYPE = {
  OBSERVE: "OBSERVE",
  RECOMMEND: "RECOMMEND",
  AUTOMATE: "AUTOMATE",
  SUPPRESS: "SUPPRESS",
  PREDICT_BLOCKED: "PREDICT_BLOCKED",
  RECOVERY: "RECOVERY"
} as const;
