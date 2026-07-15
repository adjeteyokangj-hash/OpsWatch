import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { computeConfidence, type ConfidenceResult } from "./confidence.service";
import {
  evaluatePredictionGate,
  newPredictionCandidateFields
} from "./prediction-gate.service";
import { isFeatureGateEnabled } from "./feature-gates.service";
import { MIN_BASELINE_SAMPLES, PREDICTION_STATUS } from "./intelligence-constants";
import { upsertLearningBaseline } from "./learning.service";

/**
 * Phase 8 — learning / risk / prediction framework scaffolding.
 * Observes and scores only; product emission stays gated OFF by default.
 */

export type RiskAssessment = {
  organizationId: string;
  projectId: string | null;
  scopeType: string;
  scopeKey: string;
  riskScore: number;
  label: "LOW" | "MEDIUM" | "HIGH" | "INSUFFICIENT";
  evidenceCount: number;
  factors: string[];
  emitToProduct: false;
};

export const assessOperationalRisk = (input: {
  organizationId: string;
  projectId?: string | null;
  scopeType: string;
  scopeKey: string;
  sampleCount: number;
  failureRate?: number;
  burnRate?: number;
}): RiskAssessment => {
  const factors: string[] = [];
  let riskScore = 0;

  if (input.sampleCount < MIN_BASELINE_SAMPLES) {
    return {
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      scopeType: input.scopeType,
      scopeKey: input.scopeKey,
      riskScore: 0,
      label: "INSUFFICIENT",
      evidenceCount: input.sampleCount,
      factors: [`Need at least ${MIN_BASELINE_SAMPLES} samples before risk scoring`],
      emitToProduct: false
    };
  }

  const failureRate = input.failureRate ?? 0;
  const burnRate = input.burnRate ?? 0;
  if (failureRate > 0.05) {
    riskScore += Math.min(0.5, failureRate);
    factors.push(`Failure rate ${(failureRate * 100).toFixed(1)}%`);
  }
  if (burnRate > 1) {
    riskScore += Math.min(0.4, burnRate / 10);
    factors.push(`Error-budget burn rate ${burnRate.toFixed(2)}`);
  }
  riskScore = Math.max(0, Math.min(1, Number(riskScore.toFixed(4))));

  const label: RiskAssessment["label"] =
    riskScore >= 0.7 ? "HIGH" : riskScore >= 0.4 ? "MEDIUM" : "LOW";

  return {
    organizationId: input.organizationId,
    projectId: input.projectId ?? null,
    scopeType: input.scopeType,
    scopeKey: input.scopeKey,
    riskScore,
    label,
    evidenceCount: input.sampleCount,
    factors,
    emitToProduct: false
  };
};

export const buildGatedPredictionDraft = (input: {
  title: string;
  summary: string;
  predictionType: string;
  confidence: ConfidenceResult;
}) => {
  const fields = newPredictionCandidateFields(input);
  const gate = evaluatePredictionGate(input.confidence);
  return {
    ...fields,
    emitToProduct: gate.emitToProduct,
    gateReason: gate.reason,
    advancedRcaEnabled: isFeatureGateEnabled("ADVANCED_RCA")
  };
};

export const recordPredictionOutcome = async (input: {
  organizationId: string;
  predictionId?: string | null;
  predictedOutcome: string;
  actualOutcome: string;
  wasCorrect: boolean;
}): Promise<{ id: string }> => {
  const id = randomUUID();
  await prisma.predictionAccuracyLog.create({
    data: {
      id,
      organizationId: input.organizationId,
      predictionId: input.predictionId ?? null,
      predictedOutcome: input.predictedOutcome,
      actualOutcome: input.actualOutcome,
      wasCorrect: input.wasCorrect
    }
  });
  return { id };
};

export const recordFalsePositive = async (input: {
  organizationId: string;
  predictionId?: string | null;
  predictedOutcome: string;
}): Promise<{ id: string }> =>
  recordPredictionOutcome({
    organizationId: input.organizationId,
    predictionId: input.predictionId,
    predictedOutcome: input.predictedOutcome,
    actualOutcome: "FALSE_POSITIVE",
    wasCorrect: false
  });

/**
 * Observe → baseline → risk → gated prediction draft. Never emits predictions
 * when OPSWATCH_PREDICTIONS_ENABLED is unset/false.
 */
export const runLearningPredictionCycle = async (input: {
  organizationId: string;
  projectId?: string | null;
  scopeType: string;
  scopeKey: string;
  metrics: Record<string, number | string | boolean | null>;
  failureRate?: number;
  burnRate?: number;
}): Promise<{
  baselineReady: boolean;
  sampleCount: number;
  risk: RiskAssessment;
  prediction: ReturnType<typeof buildGatedPredictionDraft> | null;
  predictionsEnabled: boolean;
}> => {
  const baseline = await upsertLearningBaseline({
    organizationId: input.organizationId,
    projectId: input.projectId,
    scopeType: input.scopeType,
    scopeKey: input.scopeKey,
    metrics: input.metrics
  });

  const risk = assessOperationalRisk({
    organizationId: input.organizationId,
    projectId: input.projectId,
    scopeType: input.scopeType,
    scopeKey: input.scopeKey,
    sampleCount: baseline.sampleCount,
    failureRate: input.failureRate,
    burnRate: input.burnRate
  });

  const confidence = computeConfidence({
    evidenceCount: baseline.sampleCount,
    historicalAccuracy: null,
    matchingIncidents: 0,
    recoveryMatches: 0,
    dataCompleteness: Math.min(1, baseline.sampleCount / MIN_BASELINE_SAMPLES)
  });

  const predictionsEnabled = isFeatureGateEnabled("PREDICTIONS");
  const prediction = predictionsEnabled
    ? buildGatedPredictionDraft({
        title: `Risk trajectory for ${input.scopeType}:${input.scopeKey}`,
        summary: risk.factors.join("; ") || "Baseline updating",
        predictionType: "RISK_TRAJECTORY",
        confidence
      })
    : null;

  if (prediction && prediction.status === PREDICTION_STATUS.DISABLED) {
    // Defensive: even if flag flipped mid-cycle, never persist READY while disabled.
    prediction.status = PREDICTION_STATUS.DISABLED;
  }

  return {
    baselineReady: baseline.ready,
    sampleCount: baseline.sampleCount,
    risk,
    prediction,
    predictionsEnabled
  };
};
