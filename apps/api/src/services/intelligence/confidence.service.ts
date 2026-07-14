import {
  CONFIDENCE_LABEL,
  MIN_DISPLAY_CONFIDENCE,
  MIN_RECOMMENDATION_CONFIDENCE,
  type ConfidenceLabel
} from "./intelligence-constants";

export type ConfidenceFactors = {
  evidenceCount: number;
  historicalAccuracy?: number | null;
  matchingIncidents?: number;
  recoveryMatches?: number;
  dataCompleteness?: number;
};

export type ConfidenceResult = {
  score: number;
  label: ConfidenceLabel;
  evidenceCount: number;
  historicalAccuracy: number | null;
  matchingIncidents: number;
  recoveryMatches: number;
  dataCompleteness: number;
  displayEligible: boolean;
  recommendationEligible: boolean;
  factors: Record<string, number>;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Score confidence from real evidence only.
 * Incomplete data and low sample counts pull the score down — never invent certainty.
 */
export const computeConfidence = (factors: ConfidenceFactors): ConfidenceResult => {
  const evidenceCount = Math.max(0, factors.evidenceCount);
  const matchingIncidents = Math.max(0, factors.matchingIncidents ?? 0);
  const recoveryMatches = Math.max(0, factors.recoveryMatches ?? 0);
  const dataCompleteness = clamp01(factors.dataCompleteness ?? 0);
  const historicalAccuracy =
    factors.historicalAccuracy == null
      ? null
      : clamp01(factors.historicalAccuracy);

  // Evidence volume curve: 0 samples → 0; ~10 samples → ~0.7; 40+ → ~1.0
  const evidenceScore = clamp01(1 - Math.exp(-evidenceCount / 12));
  const matchScore = clamp01(
    matchingIncidents === 0 ? 0 : 1 - Math.exp(-matchingIncidents / 4)
  );
  const recoveryScore = clamp01(
    recoveryMatches === 0 ? 0 : 1 - Math.exp(-recoveryMatches / 3)
  );
  const accuracyScore = historicalAccuracy ?? 0.5;

  // No evidence → no confidence. Do not allow default accuracy weight to invent signal.
  const score =
    evidenceCount === 0
      ? 0
      : clamp01(
          evidenceScore * 0.35 +
            accuracyScore * 0.25 +
            matchScore * 0.15 +
            recoveryScore * 0.1 +
            dataCompleteness * 0.15
        );

  let label: ConfidenceLabel = CONFIDENCE_LABEL.INSUFFICIENT;
  if (evidenceCount === 0 || dataCompleteness < 0.15) {
    label = CONFIDENCE_LABEL.INSUFFICIENT;
  } else if (score >= 0.8) {
    label = CONFIDENCE_LABEL.HIGH;
  } else if (score >= 0.55) {
    label = CONFIDENCE_LABEL.MEDIUM;
  } else {
    label = CONFIDENCE_LABEL.LOW;
  }

  return {
    score,
    label,
    evidenceCount,
    historicalAccuracy,
    matchingIncidents,
    recoveryMatches,
    dataCompleteness,
    displayEligible: score >= MIN_DISPLAY_CONFIDENCE && evidenceCount >= 3,
    recommendationEligible:
      score >= MIN_RECOMMENDATION_CONFIDENCE &&
      evidenceCount >= 2 &&
      label !== CONFIDENCE_LABEL.INSUFFICIENT,
    factors: {
      evidenceScore,
      accuracyScore,
      matchScore,
      recoveryScore,
      dataCompleteness
    }
  };
};

/** Gate: never surface a recommendation without recommendationEligible. */
export const assertRecommendationAllowed = (
  confidence: ConfidenceResult
): { allowed: boolean; reason: string } => {
  if (!confidence.recommendationEligible) {
    return {
      allowed: false,
      reason:
        confidence.label === CONFIDENCE_LABEL.INSUFFICIENT
          ? "Insufficient evidence to recommend an action"
          : `Confidence ${confidence.score.toFixed(2)} below recommendation threshold`
    };
  }
  return { allowed: true, reason: "Evidence-backed recommendation allowed" };
};
