/**
 * Serverless worker tick orchestrator.
 *
 * Executes the due subset of the worker job batch within a bounded time budget,
 * under a cross-process lease, and persists a run record plus per-job state. It
 * reuses the existing worker job business logic (injected via `runners`) rather
 * than reimplementing it.
 *
 * The function is dependency-injected (prisma, runners, lock, heartbeat, clock)
 * so the due/budget/retry/summary behaviour is unit testable without a database
 * or the real jobs.
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

export type JobRunner = () => Promise<void>;
export type JobRunners = Record<string, JobRunner>;

export type TickJobStatus = "SUCCEEDED" | "FAILED" | "DEFERRED" | "MISSING_RUNNER";

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
  /** Monotonic elapsed-time source in ms; defaults to `Date.now`. */
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

const truncate = (value: string, max = 500): string =>
  value.length > max ? `${value.slice(0, max - 1)}\u2026` : value;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const runServerlessWorkerTick = async (options: RunTickOptions): Promise<TickSummary> => {
  const prisma = options.prismaClient ?? (defaultPrisma as unknown as TickPrisma);
  const env = options.env ?? process.env;
  const cadences = options.cadences ?? JOB_CADENCES;
  const budgetMs = options.budgetMs ?? resolveTickBudgetMs(env);
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

  const lock = await acquire(prisma, holder, lockTtlMs, now);
  if (!lock.acquired) {
    // Another tick is running — record a lightweight skip and return fast.
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

    const dueJobs = computeDueJobs(cadences, stateByName, now);

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
        // Do not advance nextDueAt: the job stays due for the next tick.
        continue;
      }

      const runner = options.runners[jobName];
      const jobStart = clock();
      const previous = stateByName.get(jobName);

      if (!runner) {
        const durationMs = clock() - jobStart;
        jobResults.push({
          job: jobName,
          status: "MISSING_RUNNER",
          durationMs,
          error: "No runner registered for job"
        });
        await persistJobState(prisma, jobName, {
          now,
          durationMs,
          succeeded: false,
          error: "No runner registered for job",
          nextDueAt: now,
          previous
        });
        continue;
      }

      try {
        await runner();
        const durationMs = clock() - jobStart;
        jobResults.push({ job: jobName, status: "SUCCEEDED", durationMs });
        await persistJobState(prisma, jobName, {
          now,
          durationMs,
          succeeded: true,
          error: null,
          nextDueAt: new Date(now.getTime() + cadenceMs),
          previous
        });
      } catch (error) {
        const durationMs = clock() - jobStart;
        const message = truncate(errorText(error));
        logger.error(`[serverless-tick] job ${jobName} failed`, error);
        jobResults.push({ job: jobName, status: "FAILED", durationMs, error: message });
        // Failed jobs become immediately due again so the next tick retries them.
        await persistJobState(prisma, jobName, {
          now,
          durationMs,
          succeeded: false,
          error: message,
          nextDueAt: now,
          previous
        });
      }
    }

    const heartbeatUpdated = await recordHeartbeat().catch((error) => {
      logger.error("[serverless-tick] heartbeat update failed", error);
      return false;
    });

    const jobsSucceeded = jobResults.filter((row) => row.status === "SUCCEEDED").length;
    const jobsFailed = jobResults.filter(
      (row) => row.status === "FAILED" || row.status === "MISSING_RUNNER"
    ).length;
    const jobsDeferred = deferred.length;
    const jobsAttempted = jobsSucceeded + jobsFailed;
    const durationMs = clock() - startedClock;

    const status: TickStatus =
      jobsFailed === 0 ? "COMPLETED" : jobsSucceeded > 0 || jobsDeferred > 0 ? "PARTIAL" : "FAILED";

    const failedJobs = jobResults.filter((row) => row.error).map((row) => `${row.job}: ${row.error}`);
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
        jobsSkipped: 0,
        heartbeatUpdated,
        heartbeatAt,
        errorSummary,
        summaryJson: {
          dueJobs,
          jobs: jobResults,
          deferred,
          budgetMs,
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
      jobsSkipped: 0,
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
    succeeded: boolean;
    error: string | null;
    nextDueAt: Date;
    previous?: { consecutiveFailures: number; totalRuns: number; totalFailures: number };
  }
): Promise<void> => {
  const lastStatus = input.succeeded ? "SUCCEEDED" : "FAILED";
  const consecutiveFailures = input.succeeded ? 0 : (input.previous?.consecutiveFailures ?? 0) + 1;
  const totalRuns = (input.previous?.totalRuns ?? 0) + 1;
  const totalFailures = (input.previous?.totalFailures ?? 0) + (input.succeeded ? 0 : 1);

  await prisma.workerJobState.upsert({
    where: { jobName },
    create: {
      jobName,
      lastRunAt: input.now,
      lastFinishedAt: input.now,
      lastStatus,
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
      lastStatus,
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
