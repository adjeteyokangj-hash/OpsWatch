import { describe, expect, it, vi } from "vitest";
import { runServerlessWorkerTick, type JobRunners, type TickPrisma } from "./serverless-tick.service";
import type { JobCadence } from "./serverless-tick-schedule";
import type { TickLock, TickLockPrisma } from "./serverless-tick-lock";

type JobStateRow = {
  jobName: string;
  nextDueAt: Date | null;
  consecutiveFailures: number;
  totalRuns: number;
  totalFailures: number;
};

type UpsertCall = { jobName: string; update: Record<string, unknown>; create: Record<string, unknown> };

const makeFakePrisma = (states: JobStateRow[] = []) => {
  const jobStates = new Map(states.map((state) => [state.jobName, state]));
  const runs: Array<Record<string, unknown>> = [];
  const upserts: UpsertCall[] = [];

  const prisma: TickPrisma & {
    _runs: typeof runs;
    _upserts: typeof upserts;
  } = {
    _runs: runs,
    _upserts: upserts,
    workerTickLock: {
      upsert: vi.fn(async () => undefined),
      updateMany: vi.fn(async () => ({ count: 1 }))
    } as unknown as TickLockPrisma["workerTickLock"],
    workerTickRun: {
      create: vi.fn(async ({ data }: { data: any }) => {
        runs.push({ ...data });
        return { id: data.id as string };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
        const run = runs.find((row) => row.id === where.id);
        if (run) {
          Object.assign(run, data);
        }
        return run as unknown;
      })
    },
    workerJobState: {
      findMany: vi.fn(async () => Array.from(jobStates.values())),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        upserts.push({ jobName: where.jobName, create, update });
        return undefined;
      })
    }
  };

  return prisma;
};

const cadences: JobCadence[] = [
  { name: "a", envKey: "WORKER_A_INTERVAL_MS", defaultMs: 60_000 },
  { name: "b", envKey: "WORKER_B_INTERVAL_MS", defaultMs: 120_000 }
];

const now = new Date("2026-07-21T07:00:00.000Z");

const acquireGranted = (release = vi.fn(async () => undefined)) => {
  const acquire = vi.fn(
    async (): Promise<TickLock> => ({ acquired: true, holder: "h", release })
  );
  return { acquire, release };
};

describe("runServerlessWorkerTick", () => {
  it("runs all due jobs, advances each nextDueAt by its cadence, and reports success", async () => {
    const prisma = makeFakePrisma();
    const { acquire, release } = acquireGranted();
    const runners: JobRunners = {
      a: vi.fn(async () => undefined),
      b: vi.fn(async () => undefined)
    };
    const recordHeartbeat = vi.fn(async () => true);

    const summary = await runServerlessWorkerTick({
      prismaClient: prisma,
      runners,
      cadences,
      now,
      env: {},
      clock: () => 0,
      acquireLock: acquire,
      recordHeartbeat
    });

    expect(summary.ok).toBe(true);
    expect(summary.status).toBe("COMPLETED");
    expect(summary.jobsAttempted).toBe(2);
    expect(summary.jobsSucceeded).toBe(2);
    expect(summary.jobsFailed).toBe(0);
    expect(summary.jobsDeferred).toBe(0);
    expect(summary.heartbeatUpdated).toBe(true);
    expect(runners.a).toHaveBeenCalledTimes(1);
    expect(runners.b).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);

    const upsertA = prisma._upserts.find((call) => call.jobName === "a")!;
    const upsertB = prisma._upserts.find((call) => call.jobName === "b")!;
    expect((upsertA.update.nextDueAt as Date).getTime()).toBe(now.getTime() + 60_000);
    expect((upsertB.update.nextDueAt as Date).getTime()).toBe(now.getTime() + 120_000);
    expect(upsertA.update.lastStatus).toBe("SUCCEEDED");
  });

  it("skips jobs that are not yet due", async () => {
    const prisma = makeFakePrisma([
      { jobName: "a", nextDueAt: new Date(now.getTime() + 60_000), consecutiveFailures: 0, totalRuns: 3, totalFailures: 0 }
    ]);
    const { acquire } = acquireGranted();
    const runners: JobRunners = {
      a: vi.fn(async () => undefined),
      b: vi.fn(async () => undefined)
    };

    const summary = await runServerlessWorkerTick({
      prismaClient: prisma,
      runners,
      cadences,
      now,
      env: {},
      clock: () => 0,
      acquireLock: acquire,
      recordHeartbeat: vi.fn(async () => true)
    });

    expect(runners.a).not.toHaveBeenCalled();
    expect(runners.b).toHaveBeenCalledTimes(1);
    expect(summary.jobsSucceeded).toBe(1);
  });

  it("marks a failing job as immediately re-due and increments failure counters (retry semantics)", async () => {
    const prisma = makeFakePrisma([
      { jobName: "a", nextDueAt: null, consecutiveFailures: 2, totalRuns: 5, totalFailures: 2 }
    ]);
    const { acquire } = acquireGranted();
    const runners: JobRunners = {
      a: vi.fn(async () => {
        throw new Error("boom");
      })
    };

    const summary = await runServerlessWorkerTick({
      prismaClient: prisma,
      runners,
      cadences: [cadences[0]],
      now,
      env: {},
      clock: () => 0,
      acquireLock: acquire,
      recordHeartbeat: vi.fn(async () => true),
      logger: { error: vi.fn(), info: vi.fn() }
    });

    expect(summary.ok).toBe(false);
    expect(summary.status).toBe("FAILED");
    expect(summary.jobsFailed).toBe(1);
    expect(summary.errorSummary).toContain("boom");

    const upsertA = prisma._upserts.find((call) => call.jobName === "a")!;
    expect(upsertA.update.lastStatus).toBe("FAILED");
    // Immediately re-due: nextDueAt equals now (not now + cadence).
    expect((upsertA.update.nextDueAt as Date).getTime()).toBe(now.getTime());
    expect(upsertA.update.consecutiveFailures).toBe(3);
    expect(upsertA.update.totalRuns).toBe(6);
    expect(upsertA.update.totalFailures).toBe(3);
  });

  it("defers remaining jobs once the time budget is exhausted, leaving them due", async () => {
    const prisma = makeFakePrisma();
    const { acquire } = acquireGranted();
    let elapsed = 0;
    const runners: JobRunners = {
      a: vi.fn(async () => {
        // First job consumes the entire budget.
        elapsed = 1_000;
      }),
      b: vi.fn(async () => undefined)
    };

    const summary = await runServerlessWorkerTick({
      prismaClient: prisma,
      runners,
      cadences,
      now,
      env: {},
      budgetMs: 500,
      clock: () => elapsed,
      acquireLock: acquire,
      recordHeartbeat: vi.fn(async () => true)
    });

    expect(runners.a).toHaveBeenCalledTimes(1);
    expect(runners.b).not.toHaveBeenCalled();
    expect(summary.jobsDeferred).toBe(1);
    expect(summary.deferred).toEqual(["b"]);
    // Deferred job must NOT have its nextDueAt advanced.
    expect(prisma._upserts.find((call) => call.jobName === "b")).toBeUndefined();
    // No failures => still COMPLETED even with deferrals.
    expect(summary.status).toBe("COMPLETED");
  });

  it("skips fast without running jobs when the lease cannot be acquired (overlap)", async () => {
    const prisma = makeFakePrisma();
    const runner = vi.fn(async () => undefined);
    const acquire = vi.fn(
      async (): Promise<TickLock> => ({ acquired: false, holder: "other", release: async () => undefined })
    );

    const summary = await runServerlessWorkerTick({
      prismaClient: prisma,
      runners: { a: runner, b: runner },
      cadences,
      now,
      env: {},
      clock: () => 0,
      acquireLock: acquire,
      recordHeartbeat: vi.fn(async () => true)
    });

    expect(summary.status).toBe("SKIPPED_LOCK");
    expect(summary.skippedDueToLock).toBe(true);
    expect(summary.ok).toBe(true);
    expect(runner).not.toHaveBeenCalled();
    // A skip run row is persisted for observability.
    expect(prisma._runs.some((row) => row.status === "SKIPPED_LOCK")).toBe(true);
  });

  it("counts a due job with no registered runner as a failure and re-dues it", async () => {
    const prisma = makeFakePrisma();
    const { acquire } = acquireGranted();

    const summary = await runServerlessWorkerTick({
      prismaClient: prisma,
      runners: {},
      cadences: [cadences[0]],
      now,
      env: {},
      clock: () => 0,
      acquireLock: acquire,
      recordHeartbeat: vi.fn(async () => true),
      logger: { error: vi.fn(), info: vi.fn() }
    });

    expect(summary.jobsFailed).toBe(1);
    expect(summary.jobs[0].status).toBe("MISSING_RUNNER");
    const upsertA = prisma._upserts.find((call) => call.jobName === "a")!;
    expect((upsertA.update.nextDueAt as Date).getTime()).toBe(now.getTime());
  });

  it("still releases the lease when heartbeat recording throws", async () => {
    const prisma = makeFakePrisma();
    const release = vi.fn(async () => undefined);
    const { acquire } = acquireGranted(release);

    const summary = await runServerlessWorkerTick({
      prismaClient: prisma,
      runners: { a: vi.fn(async () => undefined), b: vi.fn(async () => undefined) },
      cadences,
      now,
      env: {},
      clock: () => 0,
      acquireLock: acquire,
      recordHeartbeat: vi.fn(async () => {
        throw new Error("heartbeat down");
      }),
      logger: { error: vi.fn(), info: vi.fn() }
    });

    expect(summary.heartbeatUpdated).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
