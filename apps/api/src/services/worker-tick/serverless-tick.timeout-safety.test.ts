import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runServerlessWorkerTick,
  type TickPrisma
} from "./serverless-tick.service";
import type { TickLock, TickLockPrisma } from "./serverless-tick-lock";

const makePrisma = (): TickPrisma => ({
  workerTickLock: {
    upsert: vi.fn(async () => undefined),
    updateMany: vi.fn(async () => ({ count: 1 }))
  } as unknown as TickLockPrisma["workerTickLock"],
  workerTickRun: {
    create: vi.fn(async ({ data }: { data: any }) => ({ id: data.id as string })),
    update: vi.fn(async () => undefined)
  },
  workerJobState: {
    findMany: vi.fn(async () => []),
    upsert: vi.fn(async () => undefined)
  }
});

describe("serverless worker timeout lease safety", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not release the lease until a runner that crossed the soft timeout has settled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T07:00:00.000Z"));

    let runnerSettled = false;
    const release = vi.fn(async () => {
      expect(runnerSettled).toBe(true);
    });
    const renew = vi.fn(async () => true);
    const acquireLock = vi.fn(async (): Promise<TickLock> => ({
      acquired: true,
      holder: "timeout-test",
      renew,
      release
    }));

    const tickPromise = runServerlessWorkerTick({
      prismaClient: makePrisma(),
      cadences: [{ name: "slowJob", envKey: "WORKER_SLOW_INTERVAL_MS", defaultMs: 60_000 }],
      runners: {
        slowJob: async () => {
          await new Promise<void>((resolve) => {
            setTimeout(() => {
              runnerSettled = true;
              resolve();
            }, 50);
          });
        }
      },
      now: new Date("2026-07-22T07:00:00.000Z"),
      clock: () => Date.now(),
      budgetMs: 1_000,
      lockTtlMs: 3_000,
      env: { OPSWATCH_WORKER_JOB_TIMEOUT_MS: "10" },
      acquireLock,
      recordHeartbeat: vi.fn(async () => true),
      logger: { error: vi.fn(), info: vi.fn() }
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(runnerSettled).toBe(false);
    expect(release).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(40);
    const summary = await tickPromise;

    expect(runnerSettled).toBe(true);
    expect(summary.jobs[0]?.status).toBe("TIMED_OUT");
    expect(summary.jobsFailed).toBe(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
