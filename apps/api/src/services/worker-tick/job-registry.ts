/**
 * Default runner registry for the serverless worker tick.
 *
 * Reuses the existing worker job business logic without duplication. Jobs that
 * are switched off return an explicit DISABLED outcome so the worker status
 * cannot misreport configuration-disabled work as successful execution.
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
        return {
          status: "DISABLED" as const,
          reason: "WORKER_AUTO_HEAL_ENABLED is false"
        };
      }
      await runAutoHealSweep();
    },
    runAutomationAutonomousJob: async () => {
      if (env.WORKER_AUTOMATION_AUTONOMOUS_ENABLED !== "true") {
        return {
          status: "DISABLED" as const,
          reason: "WORKER_AUTOMATION_AUTONOMOUS_ENABLED is not true"
        };
      }
      await runAutonomousAutomationSweep();
    }
  };
};
