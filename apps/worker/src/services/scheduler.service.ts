import { runHttpChecksJob } from "../jobs/run-http-checks.job";
import { runSslChecksJob } from "../jobs/run-ssl-checks.job";
import { processHeartbeatStaleJob } from "../jobs/process-heartbeat-stale.job";
import { processAlertEscalationJob } from "../jobs/process-alert-escalation.job";
import { resolveIncidentsJob } from "../jobs/resolve-incidents.job";

const runSafely = async (job: () => Promise<void>): Promise<void> => {
  try {
    await job();
  } catch (error) {
    console.error(error);
  }
};

type SchedulerOptions = {
  runOnStart?: boolean;
  httpMs?: number;
  sslMs?: number;
  heartbeatMs?: number;
  escalationMs?: number;
  resolveMs?: number;
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
    resolveMs: options.resolveMs ?? readInterval("WORKER_INCIDENT_RESOLVE_INTERVAL_MS", 10 * 60_000)
  };

  const timers: NodeJS.Timeout[] = [];

  if (options.runOnStart ?? true) {
    void runSafely(runHttpChecksJob);
    void runSafely(runSslChecksJob);
    void runSafely(processHeartbeatStaleJob);
    void runSafely(processAlertEscalationJob);
    void runSafely(resolveIncidentsJob);
  }

  timers.push(
    setInterval(() => {
      void runSafely(runHttpChecksJob);
    }, intervals.httpMs)
  );

  timers.push(
    setInterval(() => {
      void runSafely(runSslChecksJob);
    }, intervals.sslMs)
  );

  timers.push(
    setInterval(() => {
      void runSafely(processHeartbeatStaleJob);
    }, intervals.heartbeatMs)
  );

  timers.push(
    setInterval(() => {
      void runSafely(processAlertEscalationJob);
    }, intervals.escalationMs)
  );

  timers.push(
    setInterval(() => {
      void runSafely(resolveIncidentsJob);
    }, intervals.resolveMs)
  );

  return () => {
    for (const timer of timers) {
      clearInterval(timer);
    }
  };
};
