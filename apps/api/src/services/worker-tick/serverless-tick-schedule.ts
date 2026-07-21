/**
 * Cadence and due-scheduling logic for the serverless worker tick.
 *
 * These cadences mirror the interval defaults encoded in the continuous
 * scheduler (`apps/worker/src/services/scheduler.service.ts`) and honour the
 * same `WORKER_*_INTERVAL_MS` environment overrides. The serverless tick runs
 * every minute but must only execute a job when it is due, so that long-period
 * jobs (retention, learning, credential expiry, ...) are not run every minute.
 *
 * The functions here are intentionally pure (no I/O) so the due logic, budget
 * cutoff, and summary aggregation can be unit tested deterministically.
 */

export type JobCadence = {
  /** Stable job identifier — matches the exported worker job function name. */
  name: string;
  /** Environment override key, consistent with the continuous scheduler. */
  envKey: string;
  /** Default cadence in milliseconds when no override is provided. */
  defaultMs: number;
};

/**
 * Ordered by operational priority. Earlier jobs are scheduled first within a
 * tick and therefore win the execution budget when time is scarce.
 */
export const JOB_CADENCES: JobCadence[] = [
  { name: "processHeartbeatStaleJob", envKey: "WORKER_HEARTBEAT_STALE_INTERVAL_MS", defaultMs: 60_000 },
  { name: "runHttpChecksJob", envKey: "WORKER_HTTP_CHECK_INTERVAL_MS", defaultMs: 60_000 },
  { name: "processOtelBatchesJob", envKey: "WORKER_OTEL_BATCH_INTERVAL_MS", defaultMs: 30_000 },
  { name: "processOtelFreshnessJob", envKey: "WORKER_OTEL_FRESHNESS_INTERVAL_MS", defaultMs: 60_000 },
  { name: "runIncidentCorrelationJob", envKey: "WORKER_INCIDENT_CORRELATION_INTERVAL_MS", defaultMs: 2 * 60_000 },
  { name: "resolveIncidentsJob", envKey: "WORKER_INCIDENT_RESOLVE_INTERVAL_MS", defaultMs: 10 * 60_000 },
  { name: "processAlertEscalationJob", envKey: "WORKER_ALERT_ESCALATION_INTERVAL_MS", defaultMs: 5 * 60_000 },
  { name: "evaluateSloBurnRateJob", envKey: "WORKER_SLO_BURN_RATE_INTERVAL_MS", defaultMs: 5 * 60_000 },
  { name: "runIncidentAutoHealJob", envKey: "WORKER_AUTO_HEAL_INTERVAL_MS", defaultMs: 3 * 60_000 },
  { name: "runAutomationAutonomousJob", envKey: "WORKER_AUTOMATION_AUTONOMOUS_INTERVAL_MS", defaultMs: 5 * 60_000 },
  { name: "runMonitoringSyncJob", envKey: "WORKER_MONITORING_SYNC_INTERVAL_MS", defaultMs: 15 * 60_000 },
  { name: "runMaintenanceWindowTransitionsJob", envKey: "WORKER_MAINTENANCE_WINDOWS_INTERVAL_MS", defaultMs: 60_000 },
  { name: "runSslChecksJob", envKey: "WORKER_SSL_CHECK_INTERVAL_MS", defaultMs: 10 * 60_000 },
  { name: "runExpireCredentialsJob", envKey: "WORKER_CREDENTIAL_EXPIRY_INTERVAL_MS", defaultMs: 60 * 60_000 },
  { name: "runLearningCycleJob", envKey: "WORKER_LEARNING_CYCLE_INTERVAL_MS", defaultMs: 60 * 60_000 },
  { name: "pruneRetentionJob", envKey: "WORKER_RETENTION_INTERVAL_MS", defaultMs: 6 * 60 * 60_000 }
];

export const DEFAULT_TICK_BUDGET_MS = 50_000;
export const TICK_BUDGET_ENV_KEY = "OPSWATCH_WORKER_TICK_BUDGET_MS";

const readPositiveInt = (raw: string | undefined, fallback: number): number => {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Resolve a job's cadence honouring its `WORKER_*_INTERVAL_MS` override. */
export const resolveCadenceMs = (
  cadence: JobCadence,
  env: NodeJS.ProcessEnv = process.env
): number => readPositiveInt(env[cadence.envKey], cadence.defaultMs);

/** Soft execution budget; new jobs are not started once it is exceeded. */
export const resolveTickBudgetMs = (env: NodeJS.ProcessEnv = process.env): number =>
  readPositiveInt(env[TICK_BUDGET_ENV_KEY], DEFAULT_TICK_BUDGET_MS);

export type JobStateLike = {
  nextDueAt?: Date | null;
};

/** A job with no recorded state (never run) or a past `nextDueAt` is due. */
export const isJobDue = (state: JobStateLike | undefined, now: Date): boolean => {
  if (!state || !state.nextDueAt) {
    return true;
  }
  return state.nextDueAt.getTime() <= now.getTime();
};

/** Ordered list of job names that are due at `now`, preserving priority order. */
export const computeDueJobs = (
  cadences: JobCadence[],
  states: Map<string, JobStateLike>,
  now: Date
): string[] =>
  cadences.filter((cadence) => isJobDue(states.get(cadence.name), now)).map((cadence) => cadence.name);
