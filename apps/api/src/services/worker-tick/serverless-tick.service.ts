/**
 * Serverless worker tick orchestrator.
 *
 * Executes due worker jobs inside a bounded time budget, under a cross-process
 * lease, and persists truthful per-job outcomes. The orchestrator deliberately
 * distinguishes disabled work from successful work, applies bounded retry
 * backoff, renews its lease during long runs and prevents one slow job from
 * silently consuming the whole tick.
 */

import { randomUUID } from "crypto";
import { prisma as defaultPrisma } from "../../lib/prisma";
import {
  JOB_CADENCES,
  JobCadence,
  computeDueJobs,
  resolveCadenceMs,
  resolveTickBudgetMs
} from "./serverless-tick-schedule";
import {
  TICK_LOCK_KEY,
  TickLock,
  TickLockPrisma,
  acquireTickLock
} from "./serverless-tick-lock";
import { recordServerlessWorkerHeartbeat } from "./serverless-tick-heartbeat";

export type JobRunOutcome = {
  status: "DISABLED";
  reason: string;
};

export type JobRunner = () => Promise<void | JobRunOutcome>;
export type JobRunners = Record<string, JobRunner>;

export type TickJobStatus =
  | "SUCCEEDED"
  | "FAILED"
  | "TIMED_OUT"
  | "DEFERRED"
  | "DISABLED"
  | "MISSING_RUNNER";

export type TickJobResult = {
  job: string;
  status: TickJobStatus;
  durationMs: number;
  error?: string;
};

export type TickStatus = "COMPLETED" | "PARTIAL" | "FAILED" | "SKIPPED_LOCK";

export type TickSummary = {
  ok: boolean;
  status: TickStatus;
  runId: string | null;
  heartbeatUpdated: boolean;
  jobsAttempted: number;
  jobsSucceeded: number;
  jobsFailed: number;
  jobsDeferred: number;
  jobsSkipped: number;
  durationMs: number;
  skippedDueToLock: boolean;
  jobs: TickJobResult[];
  deferred: string[];
  errorSummary: string | null;
};

/** Minimal Prisma surface required by the orchestrator (satisfied by PrismaClient). */
export interface TickPrisma extends TickLockPrisma {
  workerTickRun: {
    create(args: { data: unknown }): Promise<{ id: string }>;
    update(args: { where: { id: string }; data: unknown }): Promise<unknown>;
  };
  workerJobState: {
    findMany(args?: unknown): Promise<
      Array<{
        jobName: string;
        nextDueAt: Date | null;
        lastFinishedAt?: Date | null;
        consecutiveFailures: number;
        totalRuns: number;
        totalFailures: number;
      }>
    >;
    upsert(args: { where: { jobName: string }; create: unknown; update: unknown }): Promise<unknown>;
  };
}

export type RunTickOptions = {
  prismaClient?: TickPrisma;
  runners: JobRunners;
  cadences?: JobCadence[];
  budgetMs?: number;
  now?: Date;
  clock?: () => number;
  triggeredBy?: string;
  env?: NodeJS.ProcessEnv;
  acquireLock?: (
    prisma: TickLockPrisma,
    holder: string,
    ttlMs: number,
    now: Date
  ) => Promise<TickLock>;
  recordHeartbeat?: () => Promise<boolean>;
  lockTtlMs?: number;
  logger?: Pick<Console, "error" | "info">;
};

const DEFAULT_JOB_TIMEOUT_MS = 20_000;
const DEFAULT_FAILURE_BACKOFF_BASE_MS = 60_000;
const DEFAULT_FAILURE_BACKOFF_MAX_MS = 30 * 60_000;

const truncate = (value: string, max = 500): string =>
  value.length > max ? `${value.slice(0, max - 1)}\u2026` : value;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const readPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const resolveJobTimeoutMs = (env: NodeJS.ProcessEnv): number =>
  readPositiveInt(env.OPSWATCH_WORKER_JOB_TIMEOUT_MS, DEFAULT_JOB_TIMEOUT_MS);

const resolveFailureBackoffMs = (
  previousFailures: number,
  env: NodeJS.ProcessEnv
): number => {
  const base = readPositiveInt(
    env.OPSWATCH_WORKER_FAILURE_BACKOFF_BASE_MS,
    DEFAULT_FAILURE_BACKOFF_BASE_MS
  );
  const max = readPositiveInt(
    env.OPSWATCH_WORKER_FAILURE_BACKOFF_MAX_MS,
    DEFAULT_FAILURE_BACKOFF_MAX_MS
  );
  const exponent = Math.max(0, Math.min(previousFailures, 8));
  return Math.min(max, base * 2 ** exponent);
};

class JobTimeoutError extends Error {
  constructor(jobName: string, timeoutMs: number) {
    super(`${jobName} exceeded its ${timeoutMs}ms timeout`);
    this.name = "JobTimeoutError";
  }
}

const runWithTimeout = async (
  jobName: string,
  runner: JobRunner,
  timeoutMs: number
): Promise<void | JobRunOutcome> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      runner(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new JobTimeoutError(jobName, timeoutMs)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const orderDueJobsFairly = (
  dueJobs: string[],
  stateByName: Map<
    string,
    { nextDueAt: Date | null; lastFinishedAt?: Date | null; consecutiveFailures: number }
  >,
  priorityByName: Map<string, number>
): string[] =>
  [...dueJobs].sort((left, right) => {
    const leftState = stateByName.get(left);
    const rightState = stateByName.get(right);
    const leftDue = leftState?.nextDueAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightDue = rightState?.nextDueAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;

    const leftFinished = leftState?.lastFinishedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightFinished = rightState?.lastFinishedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (leftFinished !== rightFinished) return leftFinished - rightFinished;

    return (priorityByName.get(left) ?? 0) - (priorityByName.get(right) ?? 0);
  });

export const runServerlessWorkerTick = async (options: RunTickOptions): Promise<TickSummary> => {
  const prisma = options.prismaClient ?? (defaultPrisma as unknown as TickPrisma);
  const env = options.env ?? process.env;
  const cadences = options.cadences ?? JOB_CADENCES;
  const budgetMs = options.budgetMs ?? resolveTickBudgetMs(env);
  const jobTimeoutMs = Math.min(resolveJobTimeoutMs(env), Math.max(1, budgetMs));
  const now = options.now ?? new Date();
  const clock = options.clock ?? (() => Date.now());
  const triggeredBy = options.triggeredBy ?? "supabase-cron";
  const acquire = options.acquireLock ?? acquireTickLock;
  const recordHeartbeat = options.recordHeartbeat ?? (() => recordServerlessWorkerHeartbeat());
  const lockTtlMs = options.lockTtlMs ?? budgetMs + 15_000;
  const logger = options.logger ?? console;
  const holder = `${TICK_LOCK_KEY}:${randomUUID()}`;

  const startedClock = clock();
  const cadenceByName = new Map(cadences.map((cadence) => [cadence.name, cadence]));
  const priorityByName = new Map(cadences.map((cadence, index) => [cadence.name, index]));

  const lock = await acquire(prisma, holder, lockTtlMs, now);
  if (!lock.acquired) {
    const durationMs = clock() - startedClock;
    let runId: string | null = null;
    try {
      const created = await prisma.workerTickRun.create({
        data: {
          id: randomUUID(),
          triggeredBy,
          status: "SKIPPED_LOCK",
          startedAt: now,
          completedAt: new Date(),
          durationMs,
          heartbeatUpdated: false,
          summaryJson: { skippedDueToLock: true }
        }
      });
      runId = created.id;
    } catch (error) {
      logger.error("Failed to persist skipped tick run", error);
    }
    return {
      ok: true,
      status: "SKIPPED_LOCK",
      runId,
      heartbeatUpdated: false,
      jobsAttempted: 0,
      jobsSucceeded: 0,
      jobsFailed: 0,
      jobsDeferred: 0,
      jobsSkipped: 0,
      durationMs,
      skippedDueToLock: true,
      jobs: [],
      deferred: [],
      errorSummary: null
    };
  }

  try {
    const runId = randomUUID();
    await prisma.workerTickRun.create({
      data: {
        id: runId,
        triggeredBy,
        status: "COMPLETED",
        startedAt: now
      }
    });

    const stateRows = await prisma.workerJobState.findMany();
    const stateByName = new Map(stateRows.map((row) => [row.jobName, row]));
    const dueJobs = orderDueJobsFairly(
      computeDueJobs(cadences, stateByName, now),
      stateByName,
      priorityByName
    );

    const jobResults: TickJobResult[] = [];
    const deferred: string[] = [];
    let budgetExhausted = false;

    for (const jobName of dueJobs) {
      const cadence = cadenceByName.get(jobName)!;
      const cadenceMs = resolveCadenceMs(cadence, env);

      if (budgetExhausted || clock() - startedClock >= budgetMs) {
        budgetExhausted = true;
        deferred.push(jobName);
        jobResults.push({ job: jobName, status: "DEFERRED", durationMs: 0 });
        continue;
      }

      const runner = options.runners[jobName];
      const jobStart = clock();
      const previous = stateByName.get(jobName);

      if (!runner) {
        const durationMs = clock() - jobStart;
        const backoffMs = resolveFailureBackoffMs(previous?.consecutiveFailures ?? 0, env);
        jobResults.push({
          job: jobName,
          status: "MISSING_RUNNER",
          durationMs,
          error: "No runner registered for job"
        });
        await persistJobState(prisma, jobName, {
          now,
          durationMs,
          status: "FAILED",
          error: "No runner registered for job",
          nextDueAt: new Date(now.getTime() + backoffMs),
          previous
        });
        await lock.renew?.(lockTtlMs).catch(() => false);
        continue;
      }

      try {
        const outcome = await runWithTimeout(jobName, runner, jobTimeoutMs);
        const durationMs = clock() - jobStart;

        if (outcome?.status === "DISABLED") {
          jobResults.push({
            job: jobName,
            status: "DISABLED",
            durationMs,
            error: truncate(outcome.reason)
          });
          await persistJobState(prisma, jobName, {
            now,
            durationMs,
            status: "DISABLED",
            error: truncate(outcome.reason),
            nextDueAt: new Date(now.getTime() + cadenceMs),
            previous
          });
        } else {
          jobResults.push({ job: jobName, status: "SUCCEEDED", durationMs });
          await persistJobState(prisma, jobName, {
            now,
            durationMs,
            status: "SUCCEEDED",
            error: null,
            nextDueAt: new Date(now.getTime() + cadenceMs),
            previous
          });
        }
      } catch (error) {
        const durationMs = clock() - jobStart;
        const message = truncate(errorText(error));
        const timedOut = error instanceof JobTimeoutError;
        const backoffMs = resolveFailureBackoffMs(previous?.consecutiveFailures ?? 0, env);
        logger.error(`[serverless-tick] job ${jobName} ${timedOut ? "timed out" : "failed"}`, error);
        jobResults.push({
          job: jobName,
          status: timedOut ? "TIMED_OUT" : "FAILED",
          durationMs,
          error: message
        });
        await persistJobState(prisma, jobName, {
          now,
          durationMs,
          status: "FAILED",
          error: message,
          nextDueAt: new Date(now.getTime() + backoffMs),
          previous
        });
      }

      const renewed = await lock.renew?.(lockTtlMs).catch(() => false);
      if (lock.renew && !renewed) {
        logger.error(`[serverless-tick] lost lease after ${jobName}`);
        budgetExhausted = true;
      }
    }

    const heartbeatUpdated = await recordHeartbeat().catch((error) => {
      logger.error("[serverless-tick] heartbeat update failed", error);
      return false;
    });

    const jobsSucceeded = jobResults.filter((row) => row.status === "SUCCEEDED").length;
    const jobsFailed = jobResults.filter((row) =>
      ["FAILED", "TIMED_OUT", "MISSING_RUNNER"].includes(row.status)
    ).length;
    const jobsDeferred = jobResults.filter((row) => row.status === "DEFERRED").length;
    const jobsSkipped = jobResults.filter((row) => row.status === "DISABLED").length;
    const jobsAttempted = jobsSucceeded + jobsFailed;
    const durationMs = clock() - startedClock;

    const status: TickStatus =
      jobsFailed === 0
        ? "COMPLETED"
        : jobsSucceeded > 0 || jobsDeferred > 0 || jobsSkipped > 0
          ? "PARTIAL"
          : "FAILED";

    const failedJobs = jobResults
      .filter((row) => ["FAILED", "TIMED_OUT", "MISSING_RUNNER"].includes(row.status))
      .map((row) => `${row.job}: ${row.error ?? row.status}`);
    const errorSummary = failedJobs.length > 0 ? truncate(failedJobs.join("; "), 1000) : null;
    const heartbeatAt = heartbeatUpdated ? new Date() : null;

    await prisma.workerTickRun.update({
      where: { id: runId },
      data: {
        status,
        completedAt: new Date(),
        durationMs,
        jobsAttempted,
        jobsSucceeded,
        jobsFailed,
        jobsDeferred,
        jobsSkipped,
        heartbeatUpdated,
        heartbeatAt,
        errorSummary,
        summaryJson: {
          dueJobs,
          jobs: jobResults,
          deferred,
          budgetMs,
          jobTimeoutMs,
          budgetExhausted
        }
      }
    });

    return {
      ok: jobsFailed === 0,
      status,
      runId,
      heartbeatUpdated,
      jobsAttempted,
      jobsSucceeded,
      jobsFailed,
      jobsDeferred,
      jobsSkipped,
      durationMs,
      skippedDueToLock: false,
      jobs: jobResults,
      deferred,
      errorSummary
    };
  } finally {
    await lock.release().catch((error) => {
      logger.error("[serverless-tick] failed to release tick lock", error);
    });
  }
};

const persistJobState = async (
  prisma: TickPrisma,
  jobName: string,
  input: {
    now: Date;
    durationMs: number;
    status: "SUCCEEDED" | "FAILED" | "DISABLED";
    error: string | null;
    nextDueAt: Date;
    previous?: { consecutiveFailures: number; totalRuns: number; totalFailures: number };
  }
): Promise<void> => {
  const failed = input.status === "FAILED";
  const consecutiveFailures = failed ? (input.previous?.consecutiveFailures ?? 0) + 1 : 0;
  const totalRuns = (input.previous?.totalRuns ?? 0) + 1;
  const totalFailures = (input.previous?.totalFailures ?? 0) + (failed ? 1 : 0);

  await prisma.workerJobState.upsert({
    where: { jobName },
    create: {
      jobName,
      lastRunAt: input.now,
      lastFinishedAt: input.now,
      lastStatus: input.status,
      lastDurationMs: input.durationMs,
      lastError: input.error,
      nextDueAt: input.nextDueAt,
      consecutiveFailures,
      totalRuns,
      totalFailures,
      updatedAt: input.now
    },
    update: {
      lastRunAt: input.now,
      lastFinishedAt: input.now,
      lastStatus: input.status,
      lastDurationMs: input.durationMs,
      lastError: input.error,
      nextDueAt: input.nextDueAt,
      consecutiveFailures,
      totalRuns,
      totalFailures,
      updatedAt: input.now
    }
  });
};
