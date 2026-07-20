import { runHttpChecksJob } from "../jobs/run-http-checks.job";
import { runSslChecksJob } from "../jobs/run-ssl-checks.job";
import { processHeartbeatStaleJob } from "../jobs/process-heartbeat-stale.job";
import { processAlertEscalationJob } from "../jobs/process-alert-escalation.job";
import { resolveIncidentsJob } from "../jobs/resolve-incidents.job";
import { runIncidentCorrelationJob } from "../jobs/run-incident-correlation.job";
import { evaluateSloBurnRateJob } from "../jobs/evaluate-slo-burn-rate.job";
import { runIncidentAutoHealJob } from "../jobs/run-incident-auto-heal.job";
import { runAutomationAutonomousJob } from "../jobs/run-automation-autonomous.job";
import { runMaintenanceWindowTransitionsJob } from "../jobs/transition-maintenance-windows.job";
import { pruneRetentionJob } from "../jobs/prune-retention.job";
import { runExpireCredentialsJob } from "../jobs/expire-credentials.job";
import { processOtelBatchesJob } from "../jobs/process-otel-batches.job";
import { processOtelFreshnessJob } from "../jobs/process-otel-freshness.job";
import { runLearningCycleJob } from "../jobs/run-learning-cycle.job";
import { createExclusiveRunner } from "../lib/exclusive-job";
import { markSchedulerSuccess } from "./worker-heartbeat.service";

const runSafely = async (jobName: string, job: () => Promise<void>): Promise<void> => {
  try {
    await job();
    markSchedulerSuccess(jobName);
  } catch (error) {
    console.error(error);
  }
};

const runExclusive = createExclusiveRunner("scheduled job");

type SchedulerOptions = {
  runOnStart?: boolean;
  httpMs?: number;
  sslMs?: number;
  heartbeatMs?: number;
  escalationMs?: number;
  resolveMs?: number;
  incidentCorrelationMs?: number;
  sloBurnRateMs?: number;
  autoHealMs?: number;
  automationAutonomousMs?: number;
  maintenanceWindowsMs?: number;
  retentionMs?: number;
  credentialExpiryMs?: number;
  otelBatchesMs?: number;
  otelFreshnessMs?: number;
  learningCycleMs?: number;
};

const readInterval = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const scheduleJobs = (options: SchedulerOptions = {}): (() => void) => {
  const intervals = {
    httpMs: options.httpMs ?? readInterval("WORKER_HTTP_CHECK_INTERVAL_MS", 60_000),
    sslMs: options.sslMs ?? readInterval("WORKER_SSL_CHECK_INTERVAL_MS", 10 * 60_000),
    heartbeatMs:
      options.heartbeatMs ?? readInterval("WORKER_HEARTBEAT_STALE_INTERVAL_MS", 60_000),
    escalationMs:
      options.escalationMs ?? readInterval("WORKER_ALERT_ESCALATION_INTERVAL_MS", 5 * 60_000),
    resolveMs: options.resolveMs ?? readInterval("WORKER_INCIDENT_RESOLVE_INTERVAL_MS", 10 * 60_000),
    incidentCorrelationMs:
      options.incidentCorrelationMs ?? readInterval("WORKER_INCIDENT_CORRELATION_INTERVAL_MS", 2 * 60_000),
    sloBurnRateMs:
      options.sloBurnRateMs ?? readInterval("WORKER_SLO_BURN_RATE_INTERVAL_MS", 5 * 60_000),
    autoHealMs:
      options.autoHealMs ?? readInterval("WORKER_AUTO_HEAL_INTERVAL_MS", 3 * 60_000),
    automationAutonomousMs:
      options.automationAutonomousMs ??
      readInterval("WORKER_AUTOMATION_AUTONOMOUS_INTERVAL_MS", 5 * 60_000),
    maintenanceWindowsMs:
      options.maintenanceWindowsMs ?? readInterval("WORKER_MAINTENANCE_WINDOWS_INTERVAL_MS", 60_000),
    retentionMs:
      options.retentionMs ?? readInterval("WORKER_RETENTION_INTERVAL_MS", 6 * 60 * 60_000),
    credentialExpiryMs:
      options.credentialExpiryMs ?? readInterval("WORKER_CREDENTIAL_EXPIRY_INTERVAL_MS", 60 * 60_000),
    otelBatchesMs:
      options.otelBatchesMs ?? readInterval("WORKER_OTEL_BATCH_INTERVAL_MS", 30_000),
    otelFreshnessMs:
      options.otelFreshnessMs ?? readInterval("WORKER_OTEL_FRESHNESS_INTERVAL_MS", 60_000),
    learningCycleMs:
      options.learningCycleMs ?? readInterval("WORKER_LEARNING_CYCLE_INTERVAL_MS", 60 * 60_000)
  };

  const timers: NodeJS.Timeout[] = [];

  if (options.runOnStart ?? true) {
    void runSafely("runHttpChecksJob", runHttpChecksJob);
    void runSafely("runSslChecksJob", runSslChecksJob);
    void runSafely("processHeartbeatStaleJob", processHeartbeatStaleJob);
    void runSafely("processAlertEscalationJob", processAlertEscalationJob);
    void runSafely("resolveIncidentsJob", resolveIncidentsJob);
    void runSafely("runIncidentCorrelationJob", runIncidentCorrelationJob);
    void runSafely("evaluateSloBurnRateJob", evaluateSloBurnRateJob);
    void runExclusive(async () => {
      await runIncidentAutoHealJob();
      markSchedulerSuccess("runIncidentAutoHealJob");
    });
    void runExclusive(async () => {
      await runAutomationAutonomousJob();
      markSchedulerSuccess("runAutomationAutonomousJob");
    });
    void runSafely("runMaintenanceWindowTransitionsJob", runMaintenanceWindowTransitionsJob);
    void runSafely("pruneRetentionJob", pruneRetentionJob);
    void runSafely("runExpireCredentialsJob", runExpireCredentialsJob);
    void runExclusive(async () => {
      await processOtelBatchesJob();
      markSchedulerSuccess("processOtelBatchesJob");
    });
    void runSafely("processOtelFreshnessJob", processOtelFreshnessJob);
    void runSafely("runLearningCycleJob", runLearningCycleJob);
  }

  timers.push(
    setInterval(() => {
      void runSafely("runHttpChecksJob", runHttpChecksJob);
    }, intervals.httpMs)
  );

  timers.push(
    setInterval(() => {
      void runSafely("runSslChecksJob", runSslChecksJob);
    }, intervals.sslMs)
  );

  timers.push(
    setInterval(() => {
      void runSafely("processHeartbeatStaleJob", processHeartbeatStaleJob);
    }, intervals.heartbeatMs)
  );

  timers.push(
    setInterval(() => {
      void runSafely("processAlertEscalationJob", processAlertEscalationJob);
    }, intervals.escalationMs)
  );

  timers.push(
    setInterval(() => {
      void runSafely("resolveIncidentsJob", resolveIncidentsJob);
    }, intervals.resolveMs)
  );

  timers.push(
    setInterval(() => {
      void runSafely("runIncidentCorrelationJob", runIncidentCorrelationJob);
    }, intervals.incidentCorrelationMs)
  );

  timers.push(
    setInterval(() => {
      void runSafely("evaluateSloBurnRateJob", evaluateSloBurnRateJob);
    }, intervals.sloBurnRateMs)
  );

  timers.push(
    setInterval(() => {
      void runExclusive(async () => {
        await runIncidentAutoHealJob();
        markSchedulerSuccess("runIncidentAutoHealJob");
      });
    }, intervals.autoHealMs)
  );

  timers.push(
    setInterval(() => {
      void runExclusive(async () => {
        await runAutomationAutonomousJob();
        markSchedulerSuccess("runAutomationAutonomousJob");
      });
    }, intervals.automationAutonomousMs)
  );

  timers.push(
    setInterval(() => {
      void runSafely("runMaintenanceWindowTransitionsJob", runMaintenanceWindowTransitionsJob);
    }, intervals.maintenanceWindowsMs)
  );

  timers.push(
    setInterval(() => {
      void runSafely("pruneRetentionJob", pruneRetentionJob);
    }, intervals.retentionMs)
  );

  timers.push(
    setInterval(() => {
      void runSafely("runExpireCredentialsJob", runExpireCredentialsJob);
    }, intervals.credentialExpiryMs)
  );

  timers.push(
    setInterval(() => {
      void runExclusive(async () => {
        await processOtelBatchesJob();
        markSchedulerSuccess("processOtelBatchesJob");
      });
    }, intervals.otelBatchesMs)
  );

  timers.push(
    setInterval(() => {
      void runSafely("processOtelFreshnessJob", processOtelFreshnessJob);
    }, intervals.otelFreshnessMs)
  );

  timers.push(
    setInterval(() => {
      void runSafely("runLearningCycleJob", runLearningCycleJob);
    }, intervals.learningCycleMs)
  );

  return () => {
    for (const timer of timers) {
      clearInterval(timer);
    }
  };
};
