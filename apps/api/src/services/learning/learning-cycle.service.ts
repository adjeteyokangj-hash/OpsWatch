import { refreshMetricBaselinesForOrg } from "./baseline-calculator.service";
import { detectAnomaliesForOrg } from "./anomaly-detection.service";
import { refreshIncidentPatternMemory } from "./incident-pattern.service";
import { detectDeteriorationForOrg } from "./deterioration.service";
import { generatePredictionCandidates } from "./prediction-candidate.service";
import { learnFromRemediationOutcomes } from "./remediation-outcome.service";
import {
  applyLearningRetentionExpiry,
  ensureAlgorithmVersionsRegistered
} from "./learning-retention.service";
import { listLearningStages } from "./learning-flags";
import { prisma } from "../../lib/prisma";

export type LearningCycleResult = {
  organizationId: string;
  stages: ReturnType<typeof listLearningStages>;
  baselines: Awaited<ReturnType<typeof refreshMetricBaselinesForOrg>>;
  anomalies: Awaited<ReturnType<typeof detectAnomaliesForOrg>>;
  patterns: Awaited<ReturnType<typeof refreshIncidentPatternMemory>>;
  deterioration: Awaited<ReturnType<typeof detectDeteriorationForOrg>>;
  predictions: Awaited<ReturnType<typeof generatePredictionCandidates>>;
  remediationLearning: Awaited<ReturnType<typeof learnFromRemediationOutcomes>>;
  retention: Awaited<ReturnType<typeof applyLearningRetentionExpiry>>;
};

export const runLearningCycleForOrg = async (
  organizationId: string
): Promise<LearningCycleResult> => {
  await ensureAlgorithmVersionsRegistered();

  const baselines = await refreshMetricBaselinesForOrg(organizationId);
  const anomalies = await detectAnomaliesForOrg(organizationId);
  const patterns = await refreshIncidentPatternMemory(organizationId);
  const deterioration = await detectDeteriorationForOrg(organizationId);
  const remediationLearning = await learnFromRemediationOutcomes(organizationId);
  const predictions = await generatePredictionCandidates(organizationId);
  const retention = await applyLearningRetentionExpiry(organizationId);

  return {
    organizationId,
    stages: listLearningStages(),
    baselines,
    anomalies,
    patterns,
    deterioration,
    predictions,
    remediationLearning,
    retention
  };
};

export const runLearningCycleForAllOrgs = async (): Promise<{
  orgCount: number;
  results: LearningCycleResult[];
}> => {
  const orgs = await prisma.organization.findMany({
    select: { id: true },
    take: 500
  });
  const results: LearningCycleResult[] = [];
  for (const org of orgs) {
    results.push(await runLearningCycleForOrg(org.id));
  }
  return { orgCount: orgs.length, results };
};
