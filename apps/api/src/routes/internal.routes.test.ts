import express from "express";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_PREFIX } from "../config/constants";
import { requireAuth } from "../middleware/auth";
import { internalRouter } from "./internal.routes";

vi.mock("../services/remediation/auto-heal.service", () => ({
  runAutoHealSweep: vi.fn(async () => [])
}));

vi.mock("../services/automation/automation-run-executor.service", () => ({
  runAutonomousAutomationSweep: vi.fn(async () => ({ scanned: 0, attempted: 0 }))
}));

const postAutoHeal = async (secret?: string) => {
  const previous = process.env.WORKER_INTERNAL_SECRET;
  process.env.WORKER_INTERNAL_SECRET = "worker-secret";

  const app = express();
  app.use(express.json());
  app.use(API_PREFIX, internalRouter);
  app.use(API_PREFIX, requireAuth, express.Router());

  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secret !== undefined) {
      headers["x-opswatch-worker-secret"] = secret;
    }
    return await fetch(`http://127.0.0.1:${port}${API_PREFIX}/internal/auto-heal/run`, {
      method: "POST",
      headers
    });
  } finally {
    server.close();
    if (previous === undefined) {
      delete process.env.WORKER_INTERNAL_SECRET;
    } else {
      process.env.WORKER_INTERNAL_SECRET = previous;
    }
  }
};

describe("internal routes", () => {
  afterEach(() => {
    delete process.env.WORKER_INTERNAL_SECRET;
  });

  it("does not require a session when mounted before authenticated routers", async () => {
    const response = await postAutoHeal("worker-secret");
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ accepted: true });
  });

  it("rejects worker requests without internal authentication", async () => {
    const response = await postAutoHeal();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized worker request" });
  });
});
