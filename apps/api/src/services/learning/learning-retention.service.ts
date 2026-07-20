import { prisma } from "../../lib/prisma";
import { ALGORITHM, listLearningStages } from "./learning-flags";

const DAY = 24 * 60 * 60 * 1000;

/** Phase 9 retention windows (days). Audit/incident-linked rows kept longer via null retention. */
export const LEARNING_RETENTION_DAYS = {
  baselineSamples: 90,
  anomalyRecords: 90,
  incidentPatternMemory: 365,
  predictionCandidates: 90,
  feedbackEvaluations: 365,
  generatedExplanations: 90
} as const;

export const applyLearningRetentionExpiry = async (
  organizationId: string
): Promise<{ updated: number }> => {
  const now = new Date();
  let updated = 0;

  const baselineCut = new Date(now.getTime() + LEARNING_RETENTION_DAYS.baselineSamples * DAY);
  const anomalyCut = new Date(now.getTime() + LEARNING_RETENTION_DAYS.anomalyRecords * DAY);
  const patternCut = new Date(now.getTime() + LEARNING_RETENTION_DAYS.incidentPatternMemory * DAY);
  const predictionCut = new Date(now.getTime() + LEARNING_RETENTION_DAYS.predictionCandidates * DAY);

  updated += (
    await prisma.metricBaseline.updateMany({
      where: { organizationId, retentionExpiresAt: null },
      data: { retentionExpiresAt: baselineCut }
    })
  ).count;

  updated += (
    await prisma.anomalyRecord.updateMany({
      where: { organizationId, retentionExpiresAt: null },
      data: { retentionExpiresAt: anomalyCut }
    })
  ).count;

  updated += (
    await prisma.incidentPatternMemory.updateMany({
      where: { organizationId, retentionExpiresAt: null },
      data: { retentionExpiresAt: patternCut }
    })
  ).count;

  updated += (
    await prisma.predictionCandidate.updateMany({
      where: { organizationId, retentionExpiresAt: null },
      data: { retentionExpiresAt: predictionCut }
    })
  ).count;

  return { updated };
};

export const pruneExpiredLearningData = async (): Promise<{
  baselines: number;
  anomalies: number;
  predictions: number;
}> => {
  const now = new Date();
  const baselines = (
    await prisma.metricBaseline.deleteMany({
      where: { retentionExpiresAt: { lte: now } }
    })
  ).count;
  const anomalies = (
    await prisma.anomalyRecord.deleteMany({
      where: { retentionExpiresAt: { lte: now }, status: { not: "OPEN" } }
    })
  ).count;
  // Keep incident-linked / evaluated predictions longer — only prune expired drafts without evaluation.
  const predictions = (
    await prisma.predictionCandidate.deleteMany({
      where: {
        retentionExpiresAt: { lte: now },
        reviewState: { in: ["DRAFT", "DISMISSED", "EXPIRED"] },
        OutcomeEvaluation: null
      }
    })
  ).count;
  return { baselines, anomalies, predictions };
};

export const ensureAlgorithmVersionsRegistered = async (): Promise<void> => {
  const now = new Date();
  const stages = listLearningStages();
  const entries = [
    { name: ALGORITHM.METRIC_BASELINE, version: "1" },
    { name: ALGORITHM.ANOMALY, version: "1" },
    { name: ALGORITHM.INCIDENT_PATTERN, version: "1" },
    { name: ALGORITHM.SIMILARITY, version: "1" },
    { name: ALGORITHM.PREDICTION, version: "1" },
    { name: ALGORITHM.REMEDIATION_OUTCOME, version: "1" }
  ];

  for (const entry of entries) {
    await prisma.learningAlgorithmVersion.upsert({
      where: {
        algorithmName_version: { algorithmName: entry.name, version: entry.version }
      },
      create: {
        id: `${entry.name}-${entry.version}`,
        organizationId: null,
        algorithmName: entry.name,
        version: entry.version,
        parametersJson: { minSamplesEnv: "OPSWATCH_MIN_BASELINE_SAMPLES" },
        calculationWindowMs: 14 * DAY,
        validationStatus: "UNVALIDATED",
        featureFlagsJson: stages,
        updatedAt: now
      },
      update: {
        featureFlagsJson: stages,
        updatedAt: now
      }
    });
  }
};
