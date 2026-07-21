/**
 * Database-backed E2E for the serverless worker tick.
 *
 * Skipped unless RUN_DATABASE_E2E=true so the default `vitest run` stays
 * hermetic. Run against the local Postgres in apps/api/.env with:
 *
 *   RUN_DATABASE_E2E=true pnpm --filter @opswatch/api test -- serverless-tick.database-e2e
 *
 * It exercises the REAL Prisma models (WorkerTickRun / WorkerJobState /
 * WorkerTickLock) and the REAL cross-process lease, while injecting trivial
 * runners so no real job business logic runs against the database.
 */

import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { JobCadence } from "./serverless-tick-schedule";
import { TICK_LOCK_KEY, acquireTickLock } from "./serverless-tick-lock";
import { runServerlessWorkerTick } from "./serverless-tick.service";

config();

const RUN = process.env.RUN_DATABASE_E2E === "true";

// Synthetic cadences so we never disturb the real per-job state rows.
const cadences: JobCadence[] = [
  { name: "e2eTickJobA", envKey: "WORKER_E2E_A_INTERVAL_MS", defaultMs: 60_000 },
  { name: "e2eTickJobB", envKey: "WORKER_E2E_B_INTERVAL_MS", defaultMs: 120_000 }
];

describe.runIf(RUN)("serverless worker tick (database E2E)", () => {
  let prisma: typeof import("../../lib/prisma")["prisma"];
  const createdRunIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = await import("../../lib/prisma"));
    await prisma.workerJobState.deleteMany({ where: { jobName: { in: cadences.map((c) => c.name) } } });
  });

  afterAll(async () => {
    await prisma.workerJobState.deleteMany({ where: { jobName: { in: cadences.map((c) => c.name) } } });
    if (createdRunIds.length > 0) {
      await prisma.workerTickRun.deleteMany({ where: { id: { in: createdRunIds } } });
    }
    // Clear the singleton lease so we don't leave it held.
    await prisma.workerTickLock.updateMany({
      where: { key: TICK_LOCK_KEY },
      data: { holder: null, lockedAt: null, expiresAt: new Date(), updatedAt: new Date() }
    });
    await prisma.$disconnect();
  });

  it("persists a run record and advances per-job next-due state", async () => {
    const now = new Date();
    const summary = await runServerlessWorkerTick({
      runners: {
        e2eTickJobA: async () => undefined,
        e2eTickJobB: async () => undefined
      },
      cadences,
      now,
      triggeredBy: "database-e2e",
      recordHeartbeat: async () => false
    });

    if (summary.runId) {
      createdRunIds.push(summary.runId);
    }

    expect(summary.status).toBe("COMPLETED");
    expect(summary.jobsSucceeded).toBe(2);

    const run = await prisma.workerTickRun.findUnique({ where: { id: summary.runId! } });
    expect(run).not.toBeNull();
    expect(run?.status).toBe("COMPLETED");
    expect(run?.jobsSucceeded).toBe(2);
    expect(run?.completedAt).not.toBeNull();

    const stateA = await prisma.workerJobState.findUnique({ where: { jobName: "e2eTickJobA" } });
    const stateB = await prisma.workerJobState.findUnique({ where: { jobName: "e2eTickJobB" } });
    expect(stateA?.nextDueAt?.getTime()).toBe(now.getTime() + 60_000);
    expect(stateB?.nextDueAt?.getTime()).toBe(now.getTime() + 120_000);
    expect(stateA?.lastStatus).toBe("SUCCEEDED");
  });

  it("skips (records SKIPPED_LOCK) when another holder owns the lease", async () => {
    const holder = `${TICK_LOCK_KEY}:e2e-external-holder`;
    const held = await acquireTickLock(prisma as never, holder, 60_000, new Date());
    expect(held.acquired).toBe(true);

    try {
      const summary = await runServerlessWorkerTick({
        runners: { e2eTickJobA: async () => undefined },
        cadences: [cadences[0]],
        now: new Date(),
        triggeredBy: "database-e2e",
        recordHeartbeat: async () => false
      });

      if (summary.runId) {
        createdRunIds.push(summary.runId);
      }

      expect(summary.status).toBe("SKIPPED_LOCK");
      expect(summary.skippedDueToLock).toBe(true);
    } finally {
      await held.release();
    }
  });
});
