/**
 * Default runner registry for the serverless worker tick.
 *
 * Reuses the existing worker job business logic without duplication:
 *  - Most jobs are the exact exported functions from `@opswatch/worker/jobs`
 *    (loaded lazily at runtime; see `types/opswatch-worker-jobs.d.ts` for why
 *    the import is dynamic).
 *  - Auto-heal and autonomous automation are invoked via the in-process API
 *    services (`runAutoHealSweep` / `runAutonomousAutomationSweep`) instead of
 *    the worker's HTTP-based wrappers, because the tick already runs inside the
 *    API and a self-HTTP round-trip would be wasteful and fragile. The same
 *    env gates the worker uses are preserved.
 */

import type { JobRunners } from "./serverless-tick.service";

/**
 * Build the production job runner map. Called only from the route handler, so
 * unit/E2E tests can inject their own runners and never touch the real jobs.
 */
export const loadDefaultJobRunners = async (
  env: NodeJS.ProcessEnv = process.env
): Promise<JobRunners> => {
  const jobs = await import("@opswatch/worker/jobs");
  const { runAutoHealSweep } = await import("../remediation/auto-heal.service");
  const { runAutonomousAutomationSweep } = await import(
    "../automation/automation-run-executor.service"
  );

  return {
    runHttpChecksJob: () => jobs.runHttpChecksJob(),
    runSslChecksJob: () => jobs.runSslChecksJob(),
    processHeartbeatStaleJob: () => jobs.processHeartbeatStaleJob(),
    processAlertEscalationJob: () => jobs.processAlertEscalationJob(),
    resolveIncidentsJob: () => jobs.resolveIncidentsJob(),
    runIncidentCorrelationJob: () => jobs.runIncidentCorrelationJob(),
    evaluateSloBurnRateJob: () => jobs.evaluateSloBurnRateJob(),
    runMaintenanceWindowTransitionsJob: () => jobs.runMaintenanceWindowTransitionsJob(),
    pruneRetentionJob: () => jobs.pruneRetentionJob(),
    runExpireCredentialsJob: () => jobs.runExpireCredentialsJob(),
    processOtelBatchesJob: () => jobs.processOtelBatchesJob(),
    processOtelFreshnessJob: () => jobs.processOtelFreshnessJob(),
    runLearningCycleJob: () => jobs.runLearningCycleJob(),
    runMonitoringSyncJob: () => jobs.runMonitoringSyncJob(),
    runIncidentAutoHealJob: async () => {
      if (env.WORKER_AUTO_HEAL_ENABLED === "false") {
        return;
      }
      await runAutoHealSweep();
    },
    runAutomationAutonomousJob: async () => {
      if (env.WORKER_AUTOMATION_AUTONOMOUS_ENABLED !== "true") {
        return;
      }
      await runAutonomousAutomationSweep();
    }
  };
};
