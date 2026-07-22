import { beforeEach, describe, expect, it, vi } from "vitest";

const { runFindFirst, stateFindMany } = vi.hoisted(() => ({
  runFindFirst: vi.fn(),
  stateFindMany: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    workerTickRun: { findFirst: runFindFirst },
    workerJobState: { findMany: stateFindMany }
  }
}));

import { buildWorkerRuntimeStatus } from "./worker-runtime-status.service";

const now = new Date("2026-07-22T06:00:00.000Z");

describe("buildWorkerRuntimeStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports red and unproven when no worker tick exists", async () => {
    runFindFirst.mockResolvedValue(null);
    stateFindMany.mockResolvedValue([]);

    const result = await buildWorkerRuntimeStatus(now, {});

    expect(result.capability.tone).toBe("red");
    expect(result.capability.summary).toMatch(/not proven/i);
    expect(result.capability.evidence.source).toBe("WorkerTickRun/WorkerJobState");
    expect(result.blocked.some((row) => row.id === "worker_runtime_missing")).toBe(true);
  });

  it("reports a recent successful tick as green", async () => {
    const latest = {
      id: "run-1",
      status: "COMPLETED",
      startedAt: new Date(now.getTime() - 60_000),
      jobsAttempted: 2,
      jobsSucceeded: 2,
      jobsFailed: 0,
      jobsDeferred: 0,
      jobsSkipped: 1
    };
    runFindFirst.mockResolvedValueOnce(latest).mockResolvedValueOnce(latest);
    stateFindMany.mockResolvedValue([
      {
        jobName: "runHttpChecksJob",
        lastStatus: "SUCCEEDED",
        nextDueAt: new Date(now.getTime() + 60_000),
        consecutiveFailures: 0
      }
    ]);

    const result = await buildWorkerRuntimeStatus(now, {});

    expect(result.capability.tone).toBe("green");
    expect(result.capability.summary).toMatch(/2 succeeded/i);
    expect(result.capability.evidence.jobsDisabled).toBe(1);
  });

  it("surfaces failing and overdue jobs as blockers", async () => {
    const latest = {
      id: "run-2",
      status: "PARTIAL",
      startedAt: new Date(now.getTime() - 60_000),
      jobsAttempted: 1,
      jobsSucceeded: 0,
      jobsFailed: 1,
      jobsDeferred: 1,
      jobsSkipped: 0
    };
    runFindFirst.mockResolvedValueOnce(latest).mockResolvedValueOnce(null);
    stateFindMany.mockResolvedValue([
      {
        jobName: "runHttpChecksJob",
        lastStatus: "FAILED",
        nextDueAt: new Date(now.getTime() - 5 * 60_000),
        consecutiveFailures: 3
      }
    ]);

    const result = await buildWorkerRuntimeStatus(now, {});

    expect(result.capability.tone).toBe("red");
    expect(result.blocked.some((row) => row.id === "worker_jobs_failing")).toBe(true);
    expect(result.blocked.some((row) => row.id === "worker_jobs_overdue")).toBe(true);
  });
});
