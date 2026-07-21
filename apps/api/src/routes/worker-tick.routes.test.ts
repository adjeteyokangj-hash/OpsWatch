import express from "express";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_PREFIX } from "../config/constants";

const runServerlessWorkerTick = vi.fn(async () => ({
  ok: true,
  status: "COMPLETED",
  runId: "run-1",
  heartbeatUpdated: true,
  jobsAttempted: 2,
  jobsSucceeded: 2,
  jobsFailed: 0,
  jobsDeferred: 0,
  jobsSkipped: 0,
  durationMs: 1234,
  skippedDueToLock: false,
  jobs: [],
  deferred: [],
  errorSummary: null
}));

const loadDefaultJobRunners = vi.fn(async () => ({}));

vi.mock("../services/worker-tick/serverless-tick.service", () => ({
  runServerlessWorkerTick
}));

vi.mock("../services/worker-tick/job-registry", () => ({
  loadDefaultJobRunners
}));

const startServer = async () => {
  const { workerTickRouter } = await import("./worker-tick.routes");
  const app = express();
  app.use(express.json());
  app.use(API_PREFIX, workerTickRouter);
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  return { server, port };
};

const post = async (port: number, authorization?: string) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authorization !== undefined) {
    headers.authorization = authorization;
  }
  return fetch(`http://127.0.0.1:${port}${API_PREFIX}/internal/worker/tick`, {
    method: "POST",
    headers,
    body: JSON.stringify({ trigger: "test" })
  });
};

describe("POST /internal/worker/tick", () => {
  const previous = process.env.OPSWATCH_CRON_SECRET;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.OPSWATCH_CRON_SECRET;
    } else {
      process.env.OPSWATCH_CRON_SECRET = previous;
    }
    vi.clearAllMocks();
  });

  it("returns 401 without a valid bearer secret and never runs the tick", async () => {
    process.env.OPSWATCH_CRON_SECRET = "cron-secret";
    const { server, port } = await startServer();
    try {
      const response = await post(port, undefined);
      expect(response.status).toBe(401);
      expect(runServerlessWorkerTick).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it("returns 401 for an incorrect bearer secret", async () => {
    process.env.OPSWATCH_CRON_SECRET = "cron-secret";
    const { server, port } = await startServer();
    try {
      const response = await post(port, "Bearer nope");
      expect(response.status).toBe(401);
      expect(runServerlessWorkerTick).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it("runs the tick and returns the summary for a valid secret", async () => {
    process.env.OPSWATCH_CRON_SECRET = "cron-secret";
    const { server, port } = await startServer();
    try {
      const response = await post(port, "Bearer cron-secret");
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ ok: true, status: "COMPLETED", jobsSucceeded: 2 });
      expect(loadDefaultJobRunners).toHaveBeenCalledTimes(1);
      expect(runServerlessWorkerTick).toHaveBeenCalledTimes(1);
      expect(runServerlessWorkerTick).toHaveBeenCalledWith(
        expect.objectContaining({ triggeredBy: "supabase-cron" })
      );
    } finally {
      server.close();
    }
  });
});
