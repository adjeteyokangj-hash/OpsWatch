import { runLearningCycleForAllOrgs } from "@opswatch/api/learning-cycle";

/**
 * Phase 9 learning cycle. Stages remain env-gated (default off).
 * Does not silently emit predictions.
 */
export const runLearningCycleJob = async (): Promise<void> => {
  if (process.env.WORKER_LEARNING_CYCLE_ENABLED === "false") {
    return;
  }

  const result = await runLearningCycleForAllOrgs();
  if (result.failedOrgCount > 0) {
    const summary = result.failures
      .slice(0, 3)
      .map((failure) => `${failure.organizationId}: ${failure.error}`)
      .join("; ");
    throw new Error(
      `Learning cycle completed with ${result.failedOrgCount}/${result.orgCount} organisation failures${summary ? ` (${summary})` : ""}`
    );
  }
};
