import { prisma } from "../../lib/prisma";
import { listLearningStages } from "./learning-flags";
import { detectDeteriorationForOrg } from "./deterioration.service";
import { recommendActionsForPattern } from "./remediation-outcome.service";
import { summariseOutcomeMetrics } from "./prediction-review.service";
import { DATA_QUALITY } from "./learning-flags";

export type Phase9IntelligenceSection = {
  learningStages: ReturnType<typeof listLearningStages>;
  metricBaselines: Array<{
    id: string;
    projectId: string | null;
    environment: string;
    metricKey: string;
    sampleCount: number;
    mean: number | null;
    p95: number | null;
    confidenceLabel: string;
    dataQualityState: string;
    lastRecalculatedAt: string;
    freshness: string;
  }>;
  anomalies: Array<{
    id: string;
    projectId: string | null;
    metricKey: string;
    method: string;
    severity: string;
    observedValue: number;
    expectedMin: number | null;
    expectedMax: number | null;
    deviation: number | null;
    explanation: string;
    baselineConfidence: number;
    lastDetectedAt: string;
  }>;
  deterioration: Awaited<ReturnType<typeof detectDeteriorationForOrg>>["findings"];
  incidentPatterns: Array<{
    id: string;
    fingerprint: string;
    title: string;
    confirmedRootCause: string | null;
    recurrenceCount: number;
    verificationOutcome: string | null;
    lastSeenAt: string;
  }>;
  predictionCandidates: Array<{
    id: string;
    predictionType: string;
    title: string;
    summary: string;
    confidenceScore: number;
    confidenceLabel: string;
    reviewState: string;
    forecastHorizonMs: number | null;
    expiresAt: string | null;
    recommendedAction: string | null;
    evidenceJson: unknown;
    relatedIncidentId: string | null;
  }>;
  preventiveRecommendations: Array<{
    actionKey: string;
    recommendationConfidence: number;
    successCount: number;
    failureCount: number;
    riskLevel: string;
    note: string;
  }>;
  outcomeLearning: Awaited<ReturnType<typeof summariseOutcomeMetrics>>;
  securityRiskPatterns: Array<{
    id: string;
    metricKey: string;
    sampleCount: number;
    mean: number | null;
    confidenceLabel: string;
    wording: string;
  }>;
};

export const buildPhase9IntelligenceSection = async (
  organizationId: string
): Promise<Phase9IntelligenceSection> => {
  const stages = listLearningStages();
  const now = Date.now();

  const [metricBaselines, anomalies, patterns, predictions, deteriorationResult] =
    await Promise.all([
      prisma.metricBaseline.findMany({
        where: {
          organizationId,
          dataQualityState: {
            notIn: [DATA_QUALITY.TEST_EXCLUDED, DATA_QUALITY.FIXTURE_EXCLUDED]
          }
        },
        orderBy: { lastRecalculatedAt: "desc" },
        take: 50
      }),
      prisma.anomalyRecord.findMany({
        where: { organizationId, status: "OPEN" },
        orderBy: { lastDetectedAt: "desc" },
        take: 40
      }),
      prisma.incidentPatternMemory.findMany({
        where: { organizationId, displayEligible: true },
        orderBy: { lastSeenAt: "desc" },
        take: 30
      }),
      prisma.predictionCandidate.findMany({
        where: {
          organizationId,
          status: { in: ["READY", "INSUFFICIENT_DATA"] },
          expiresAt: { not: null }
        },
        orderBy: { computedAt: "desc" },
        take: 40
      }),
      detectDeteriorationForOrg(organizationId)
    ]);

  const preventiveRecommendations = await recommendActionsForPattern({ organizationId });
  const outcomeLearning = await summariseOutcomeMetrics(organizationId);

  const securityRiskPatterns = metricBaselines
    .filter(
      (row) =>
        row.metricKey === "login_failure_volume" ||
        row.metricKey === "security_event_volume"
    )
    .filter((row) => row.sampleCount > 0)
    .slice(0, 10)
    .map((row) => ({
      id: row.id,
      metricKey: row.metricKey,
      sampleCount: row.sampleCount,
      mean: row.mean,
      confidenceLabel: row.confidenceLabel,
      wording:
        row.confidenceLabel === "INSUFFICIENT"
          ? "Insufficient samples for security baseline"
          : "Above-normal / elevated risk wording only — not a predicted breach"
    }));

  return {
    learningStages: stages,
    metricBaselines: metricBaselines.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      environment: row.environment,
      metricKey: row.metricKey,
      sampleCount: row.sampleCount,
      mean: row.mean,
      p95: row.p95,
      confidenceLabel: row.confidenceLabel,
      dataQualityState: row.dataQualityState,
      lastRecalculatedAt: row.lastRecalculatedAt.toISOString(),
      freshness:
        now - row.lastRecalculatedAt.getTime() < 6 * 60 * 60 * 1000 ? "FRESH" : "STALE"
    })),
    anomalies: anomalies.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      metricKey: row.metricKey,
      method: row.method,
      severity: row.severity,
      observedValue: row.observedValue,
      expectedMin: row.expectedMin,
      expectedMax: row.expectedMax,
      deviation: row.deviation,
      explanation: row.explanation,
      baselineConfidence: row.baselineConfidence,
      lastDetectedAt: row.lastDetectedAt.toISOString()
    })),
    deterioration: deteriorationResult.skipped ? [] : deteriorationResult.findings,
    incidentPatterns: patterns.map((row) => ({
      id: row.id,
      fingerprint: row.fingerprint,
      title: row.title,
      confirmedRootCause: row.confirmedRootCause,
      recurrenceCount: row.recurrenceCount,
      verificationOutcome: row.verificationOutcome,
      lastSeenAt: row.lastSeenAt.toISOString()
    })),
    predictionCandidates: predictions
      .filter((row) => row.evidenceJson != null && row.expiresAt != null)
      .map((row) => ({
        id: row.id,
        predictionType: row.predictionType,
        title: row.title,
        summary: row.summary,
        confidenceScore: row.confidenceScore,
        confidenceLabel: row.confidenceLabel,
        reviewState: row.reviewState,
        forecastHorizonMs: row.forecastHorizonMs,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        recommendedAction: row.recommendedAction,
        evidenceJson: row.evidenceJson,
        relatedIncidentId: row.relatedIncidentId
      })),
    preventiveRecommendations,
    outcomeLearning,
    securityRiskPatterns
  };
};
