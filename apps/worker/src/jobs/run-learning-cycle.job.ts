import { runLearningCycleForAllOrgs } from "@opswatch/api/learning-cycle";

/**
 * Phase 9 learning cycle. Stages remain env-gated (default off).
 * Does not silently emit predictions.
 */
export const runLearningCycleJob = async (): Promise<void> => {
  if (process.env.WORKER_LEARNING_CYCLE_ENABLED === "false") {
    return;
  }
  await runLearningCycleForAllOrgs();
};
