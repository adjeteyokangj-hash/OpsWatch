import { randomUUID } from "crypto";
import {
  MIN_PREDICTION_CONFIDENCE,
  isPredictionsEnabled,
  PREDICTION_STATUS,
  type PredictionStatus
} from "./intelligence-constants";
import type { ConfidenceResult } from "./confidence.service";

export type PredictionEvaluation = {
  enabled: boolean;
  status: PredictionStatus;
  emitToProduct: boolean;
  reason: string;
  confidenceScore: number;
};

/**
 * Future prediction framework — architecture only.
 * Product emission is disabled unless OPSWATCH_PREDICTIONS_ENABLED=true
 * AND confidence meets MIN_PREDICTION_CONFIDENCE AND evidence is sufficient.
 */
export const evaluatePredictionGate = (
  confidence: ConfidenceResult
): PredictionEvaluation => {
  if (!isPredictionsEnabled()) {
    return {
      enabled: false,
      status: PREDICTION_STATUS.DISABLED,
      emitToProduct: false,
      reason:
        "Predictions are disabled (OPSWATCH_PREDICTIONS_ENABLED is not true). Building baselines only.",
      confidenceScore: confidence.score
    };
  }

  if (!confidence.displayEligible || confidence.score < MIN_PREDICTION_CONFIDENCE) {
    return {
      enabled: true,
      status: PREDICTION_STATUS.INSUFFICIENT_DATA,
      emitToProduct: false,
      reason:
        "Prediction framework active but evidence/confidence is below the release threshold",
      confidenceScore: confidence.score
    };
  }

  return {
    enabled: true,
    status: PREDICTION_STATUS.READY,
    emitToProduct: true,
    reason: "Prediction eligible (feature flag on + confidence threshold met)",
    confidenceScore: confidence.score
  };
};

export const newPredictionCandidateFields = (input: {
  confidence: ConfidenceResult;
  title: string;
  summary: string;
  predictionType: string;
}): {
  id: string;
  title: string;
  summary: string;
  predictionType: string;
  confidenceScore: number;
  status: PredictionStatus;
  evidenceJson: { gated: true; factors: ConfidenceResult["factors"] };
} => {
  const gate = evaluatePredictionGate(input.confidence);
  return {
    id: randomUUID(),
    title: input.title,
    summary: input.summary,
    predictionType: input.predictionType,
    confidenceScore: input.confidence.score,
    status: gate.status,
    evidenceJson: { gated: true, factors: input.confidence.factors }
  };
};
