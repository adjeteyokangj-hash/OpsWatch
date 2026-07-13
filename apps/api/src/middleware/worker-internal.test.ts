import express from "express";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { requireWorkerInternal } from "./worker-internal";

const postInternal = async (secret?: string) => {
  const previous = process.env.WORKER_INTERNAL_SECRET;
  process.env.WORKER_INTERNAL_SECRET = " configured-secret ";

  const app = express();
  app.post("/internal/auto-heal/run", requireWorkerInternal, (_req, res) => {
    res.status(202).json({ accepted: true });
  });

  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secret !== undefined) {
      headers["x-opswatch-worker-secret"] = secret;
    }
    return await fetch(`http://127.0.0.1:${port}/internal/auto-heal/run`, {
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

describe("requireWorkerInternal", () => {
  afterEach(() => {
    delete process.env.WORKER_INTERNAL_SECRET;
  });

  it("rejects requests without the worker secret header", async () => {
    const response = await postInternal();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized worker request" });
  });

  it("rejects requests with an invalid worker secret", async () => {
    const response = await postInternal("wrong-secret");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized worker request" });
  });

  it("accepts requests with a trimmed matching worker secret", async () => {
    const response = await postInternal(" configured-secret ");
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true });
  });
});
