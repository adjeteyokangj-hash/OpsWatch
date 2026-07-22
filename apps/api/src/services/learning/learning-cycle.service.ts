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

export type LearningCycleFailure = {
  organizationId: string;
  error: string;
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

/**
 * Run every organisation independently. A failure in one tenant is recorded and
 * does not prevent later tenants from receiving baseline, anomaly, prediction
 * and remediation-outcome updates.
 */
export const runLearningCycleForAllOrgs = async (): Promise<{
  orgCount: number;
  succeededOrgCount: number;
  failedOrgCount: number;
  results: LearningCycleResult[];
  failures: LearningCycleFailure[];
}> => {
  const orgs = await prisma.organization.findMany({
    select: { id: true },
    take: 500
  });
  const results: LearningCycleResult[] = [];
  const failures: LearningCycleFailure[] = [];

  for (const org of orgs) {
    try {
      results.push(await runLearningCycleForOrg(org.id));
    } catch (error) {
      failures.push({
        organizationId: org.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    orgCount: orgs.length,
    succeededOrgCount: results.length,
    failedOrgCount: failures.length,
    results,
    failures
  };
};
