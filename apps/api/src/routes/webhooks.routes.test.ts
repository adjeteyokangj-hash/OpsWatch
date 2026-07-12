import crypto from "crypto";
import express from "express";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockProjectFindFirst, mockAlertFindFirst, mockAlertCreate, mockAlertUpdate } = vi.hoisted(() => ({
  mockProjectFindFirst: vi.fn(),
  mockAlertFindFirst: vi.fn(),
  mockAlertCreate: vi.fn(),
  mockAlertUpdate: vi.fn()
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    project: { findFirst: mockProjectFindFirst },
    alert: {
      findFirst: mockAlertFindFirst,
      create: mockAlertCreate,
      update: mockAlertUpdate
    }
  }
}));

import { webhooksRouter } from "./webhooks.routes";

const webhookJsonParser = express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
});

const signVercel = (rawBody: string, secret: string) =>
  crypto.createHmac("sha1", secret).update(rawBody).digest("hex");

const signGitHub = (rawBody: string, secret: string) =>
  `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;

const signRender = (rawBody: string, secret: string, webhookId: string, webhookTimestamp: string) => {
  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const signature = crypto.createHmac("sha256", secret).update(signedContent).digest("base64");
  return { webhookId, webhookTimestamp, webhookSignature: `v1,${signature}` };
};

const requestWebhook = async (
  path: string,
  rawBody: string,
  headers: Record<string, string> = {}
) => {
  const app = express();
  app.use(webhookJsonParser, webhooksRouter);

  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers
      },
      body: rawBody
    });
  } finally {
    server.close();
  }
};

describe("webhooks.routes", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    mockAlertFindFirst.mockResolvedValue(null);
    mockAlertCreate.mockResolvedValue({ id: "alert-1" });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("vercel", () => {
    const secret = "vercel-test-secret";
    const rawBody = JSON.stringify({ type: "deployment.error", payload: { deployment: { project: { id: "prj_1" } } } });

    it("returns 503 when verification secret is not configured", async () => {
      delete process.env.VERCEL_WEBHOOK_SECRET;

      const response = await requestWebhook("/vercel", rawBody, {
        "x-vercel-signature": signVercel(rawBody, secret)
      });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "Webhook verification is not configured" });
    });

    it("returns 401 when signature is missing", async () => {
      process.env.VERCEL_WEBHOOK_SECRET = secret;

      const response = await requestWebhook("/vercel", rawBody);
      expect(response.status).toBe(401);
    });

    it("returns 401 when signature is invalid", async () => {
      process.env.VERCEL_WEBHOOK_SECRET = secret;

      const response = await requestWebhook("/vercel", rawBody, {
        "x-vercel-signature": "invalid"
      });
      expect(response.status).toBe(401);
    });

    it("accepts valid signatures computed from raw body bytes", async () => {
      process.env.VERCEL_WEBHOOK_SECRET = secret;
      mockProjectFindFirst.mockResolvedValue({ id: "project-1" });

      const response = await requestWebhook("/vercel", rawBody, {
        "x-vercel-signature": signVercel(rawBody, secret)
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(mockAlertCreate).toHaveBeenCalledOnce();
    });
  });

  describe("github", () => {
    const secret = "github-test-secret";
    const rawBody = JSON.stringify({
      workflow_run: {
        conclusion: "failure",
        name: "CI",
        html_url: "https://github.com/acme/repo/actions/runs/1",
        repository: { full_name: "acme/repo" }
      }
    });

    it("returns 503 when verification secret is not configured", async () => {
      delete process.env.GITHUB_WEBHOOK_SECRET;

      const response = await requestWebhook("/github", rawBody, {
        "x-hub-signature-256": signGitHub(rawBody, secret),
        "x-github-event": "workflow_run"
      });

      expect(response.status).toBe(503);
    });

    it("returns 401 for invalid signatures", async () => {
      process.env.GITHUB_WEBHOOK_SECRET = secret;

      const response = await requestWebhook("/github", rawBody, {
        "x-hub-signature-256": "sha256=deadbeef",
        "x-github-event": "workflow_run"
      });

      expect(response.status).toBe(401);
    });

    it("accepts valid signatures", async () => {
      process.env.GITHUB_WEBHOOK_SECRET = secret;
      mockProjectFindFirst.mockResolvedValue({ id: "project-1" });

      const response = await requestWebhook("/github", rawBody, {
        "x-hub-signature-256": signGitHub(rawBody, secret),
        "x-github-event": "workflow_run"
      });

      expect(response.status).toBe(200);
      expect(mockAlertCreate).toHaveBeenCalledOnce();
    });
  });

  describe("render", () => {
    const secret = "render-test-secret";
    const rawBody = JSON.stringify({
      type: "deploy_ended",
      data: { serviceId: "srv-1", status: "failed" }
    });
    const webhookId = "evt-test";
    const webhookTimestamp = String(Math.floor(Date.now() / 1000));
    const renderHeaders = signRender(rawBody, secret, webhookId, webhookTimestamp);

    it("returns 503 when verification secret is not configured", async () => {
      delete process.env.RENDER_WEBHOOK_SECRET;

      const response = await requestWebhook("/render", rawBody, {
        "webhook-id": renderHeaders.webhookId,
        "webhook-timestamp": renderHeaders.webhookTimestamp,
        "webhook-signature": renderHeaders.webhookSignature
      });

      expect(response.status).toBe(503);
    });

    it("returns 401 when standard webhook headers are missing", async () => {
      process.env.RENDER_WEBHOOK_SECRET = secret;

      const response = await requestWebhook("/render", rawBody);
      expect(response.status).toBe(401);
    });

    it("accepts valid standard webhook signatures", async () => {
      process.env.RENDER_WEBHOOK_SECRET = secret;
      mockProjectFindFirst.mockResolvedValue({ id: "project-1" });

      const response = await requestWebhook("/render", rawBody, {
        "webhook-id": renderHeaders.webhookId,
        "webhook-timestamp": renderHeaders.webhookTimestamp,
        "webhook-signature": renderHeaders.webhookSignature
      });

      expect(response.status).toBe(200);
      expect(mockAlertCreate).toHaveBeenCalledOnce();
    });
  });
});
