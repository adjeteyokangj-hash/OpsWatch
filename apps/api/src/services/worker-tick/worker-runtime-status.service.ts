import { prisma } from "../../lib/prisma";
import type {
  OpsStatusBlocked,
  OpsStatusCapability,
  OpsStatusTone
} from "../intelligence/ai-operations-status.service";
import { JOB_CADENCES, resolveCadenceMs } from "./serverless-tick-schedule";

export type WorkerRuntimeStatus = {
  capability: OpsStatusCapability;
  blocked: OpsStatusBlocked[];
};

const MINUTE_MS = 60_000;
const HEALTHY_TICK_AGE_MS = 5 * MINUTE_MS;
const STALE_TICK_AGE_MS = 15 * MINUTE_MS;

const ageMs = (value: Date | null | undefined, now: Date): number | null =>
  value ? now.getTime() - value.getTime() : null;

const toneForRun = (
  status: string | null | undefined,
  startedAt: Date | null | undefined,
  jobsFailed: number,
  jobsDeferred: number,
  now: Date
): OpsStatusTone => {
  const age = ageMs(startedAt, now);
  if (age == null || age > STALE_TICK_AGE_MS) return "red";
  if (status === "FAILED" || jobsFailed > 0) return "red";
  if (age > HEALTHY_TICK_AGE_MS || status === "PARTIAL" || jobsDeferred > 0) return "amber";
  return "green";
};

export const buildWorkerRuntimeStatus = async (
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env
): Promise<WorkerRuntimeStatus> => {
  const [latestRun, latestSuccessfulRun, states] = await Promise.all([
    prisma.workerTickRun.findFirst({ orderBy: { startedAt: "desc" } }),
    prisma.workerTickRun.findFirst({
      where: { status: "COMPLETED", jobsFailed: 0 },
      orderBy: { startedAt: "desc" }
    }),
    prisma.workerJobState.findMany({ orderBy: { jobName: "asc" } })
  ]);

  const cadenceByName = new Map(JOB_CADENCES.map((row) => [row.name, row]));
  const overdue = states.filter((state) => {
    const cadence = cadenceByName.get(state.jobName);
    if (!cadence || !state.nextDueAt) return false;
    const overdueBy = now.getTime() - state.nextDueAt.getTime();
    return overdueBy > resolveCadenceMs(cadence, env);
  });
  const failing = states.filter(
    (state) => state.lastStatus === "FAILED" || state.consecutiveFailures > 0
  );
  const disabled = states.filter((state) => state.lastStatus === "DISABLED");
  const neverRun = JOB_CADENCES.filter(
    (cadence) => !states.some((state) => state.jobName === cadence.name)
  );

  const tone = toneForRun(
    latestRun?.status,
    latestRun?.startedAt,
    latestRun?.jobsFailed ?? 0,
    latestRun?.jobsDeferred ?? 0,
    now
  );
  const latestAgeMinutes = latestRun?.startedAt
    ? Math.max(0, Math.round((now.getTime() - latestRun.startedAt.getTime()) / MINUTE_MS))
    : null;

  const summary = !latestRun
    ? "No serverless worker tick has been recorded. The worker is not proven to be running."
    : tone === "green"
      ? `Worker tick completed ${latestAgeMinutes}m ago: ${latestRun.jobsSucceeded} succeeded, ${latestRun.jobsSkipped} disabled, no failures.`
      : tone === "amber"
        ? `Worker requires attention: latest tick ${latestAgeMinutes}m ago, ${latestRun.jobsDeferred} deferred, ${overdue.length} overdue.`
        : `Worker is unhealthy or stale: latest status ${latestRun.status}, ${latestRun.jobsFailed} failed, ${failing.length} jobs failing.`;

  const blocked: OpsStatusBlocked[] = [];
  if (!latestRun) {
    blocked.push({
      id: "worker_runtime_missing",
      label: "Worker runtime",
      reason: "No WorkerTickRun evidence exists. Verify Supabase Cron, the endpoint and OPSWATCH_CRON_SECRET."
    });
  } else if (tone === "red") {
    blocked.push({
      id: "worker_runtime_unhealthy",
      label: "Worker runtime",
      reason: summary
    });
  }
  if (failing.length > 0) {
    blocked.push({
      id: "worker_jobs_failing",
      label: "Worker jobs failing",
      reason: failing
        .slice(0, 5)
        .map((row) => `${row.jobName} (${row.consecutiveFailures} consecutive)`)
        .join(", ")
    });
  }
  if (overdue.length > 0) {
    blocked.push({
      id: "worker_jobs_overdue",
      label: "Worker jobs overdue",
      reason: overdue.slice(0, 5).map((row) => row.jobName).join(", ")
    });
  }
  if (neverRun.length > 0) {
    blocked.push({
      id: "worker_jobs_never_run",
      label: "Worker jobs never run",
      reason: neverRun.slice(0, 5).map((row) => row.name).join(", ")
    });
  }

  return {
    capability: {
      id: "worker_heartbeat",
      label: "Worker runtime",
      tone,
      summary,
      lastEvidenceAt: latestRun?.startedAt?.toISOString() ?? null,
      evidence: {
        source: "WorkerTickRun/WorkerJobState",
        latestRunId: latestRun?.id ?? null,
        latestStatus: latestRun?.status ?? null,
        latestSuccessfulAt: latestSuccessfulRun?.startedAt?.toISOString() ?? null,
        jobsAttempted: latestRun?.jobsAttempted ?? 0,
        jobsSucceeded: latestRun?.jobsSucceeded ?? 0,
        jobsFailed: latestRun?.jobsFailed ?? 0,
        jobsDeferred: latestRun?.jobsDeferred ?? 0,
        jobsDisabled: latestRun?.jobsSkipped ?? 0,
        failingJobs: failing.map((row) => row.jobName),
        overdueJobs: overdue.map((row) => row.jobName),
        disabledJobs: disabled.map((row) => row.jobName),
        neverRunJobs: neverRun.map((row) => row.name)
      }
    },
    blocked
  };
};
