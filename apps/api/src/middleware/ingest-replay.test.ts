import { Prisma } from "@prisma/client";
import { createHmac, randomUUID } from "crypto";
import express from "express";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INGEST_ERROR_CODES } from "../config/constants";
import { computeIngestSignature } from "../lib/request-signature";

const { mockProjectFindFirst, mockNonceCreate } = vi.hoisted(() => ({
  mockProjectFindFirst: vi.fn(),
  mockNonceCreate: vi.fn()
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    project: { findFirst: mockProjectFindFirst },
    ingestReplayNonce: { create: mockNonceCreate }
  }
}));

import { requireIngestReplayProtection } from "../middleware/ingest-replay";

const signingSecret = "project-signing-secret";
const projectSlug = "demo-project";

const ingestJsonParser = express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
});

const signBody = (rawBody: string, opts?: { timestamp?: string; nonce?: string; secret?: string }) => {
  const timestamp = opts?.timestamp ?? new Date().toISOString();
  const nonce = opts?.nonce ?? randomUUID();
  const signature = computeIngestSignature(
    opts?.secret ?? signingSecret,
    timestamp,
    nonce,
    Buffer.from(rawBody, "utf8")
  );
  return { timestamp, nonce, signature };
};

const requestIngest = async (
  rawBody: string,
  headers: Record<string, string> = {},
  route: "event" | "health-snapshot" | "heartbeat" = "event"
) => {
  const app = express();
  app.use(ingestJsonParser);
  app.use((req: any, _res, next) => {
    req.apiKeyId = "api-key-1";
    req.apiKeyOrganizationId = "org-1";
    next();
  });
  app.post(`/${route}`, requireIngestReplayProtection(route), (_req, res) => {
    res.status(202).json({ ok: true });
  });

  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    return await fetch(`http://127.0.0.1:${port}/${route}`, {
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

describe("requireIngestReplayProtection", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      INGEST_SIGNING_REQUIRED: "true",
      INGEST_TIMESTAMP_WINDOW_SECONDS: "300"
    };
    mockProjectFindFirst.mockResolvedValue({ id: "project-1", signingSecret });
    mockNonceCreate.mockResolvedValue({ nonce: "nonce-1" });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 401 when signing headers are missing", async () => {
    const rawBody = JSON.stringify({ projectSlug, type: "SERVICE_DOWN", severity: "HIGH", source: "test", message: "down" });

    const response = await requestIngest(rawBody);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Missing ingest signing headers",
      code: INGEST_ERROR_CODES.AUTH_INVALID
    });
  });

  it("returns 503 when project signing configuration is absent", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: "project-1", signingSecret: "   " });
    const rawBody = JSON.stringify({ projectSlug, type: "SERVICE_DOWN", severity: "HIGH", source: "test", message: "down" });
    const signed = signBody(rawBody);

    const response = await requestIngest(rawBody, {
      "x-opswatch-timestamp": signed.timestamp,
      "x-opswatch-nonce": signed.nonce,
      "x-opswatch-signature": signed.signature
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Ingest signing is not configured",
      code: INGEST_ERROR_CODES.SIGNING_UNAVAILABLE
    });
  });

  it("returns 401 for malformed signatures", async () => {
    const rawBody = JSON.stringify({ projectSlug, type: "SERVICE_DOWN", severity: "HIGH", source: "test", message: "down" });
    const signed = signBody(rawBody);

    const response = await requestIngest(rawBody, {
      "x-opswatch-timestamp": signed.timestamp,
      "x-opswatch-nonce": signed.nonce,
      "x-opswatch-signature": "not-valid"
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Invalid ingest signature",
      code: INGEST_ERROR_CODES.AUTH_INVALID
    });
  });

  it("returns 401 for stale timestamps", async () => {
    const rawBody = JSON.stringify({ projectSlug, type: "SERVICE_DOWN", severity: "HIGH", source: "test", message: "down" });
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    const signed = signBody(rawBody, { timestamp: stale });

    const response = await requestIngest(rawBody, {
      "x-opswatch-timestamp": signed.timestamp,
      "x-opswatch-nonce": signed.nonce,
      "x-opswatch-signature": signed.signature
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Request timestamp is outside the acceptance window",
      code: INGEST_ERROR_CODES.STALE
    });
  });

  it("accepts valid signed requests once", async () => {
    const rawBody = JSON.stringify({ projectSlug, type: "SERVICE_DOWN", severity: "HIGH", source: "test", message: "down" });
    const signed = signBody(rawBody);

    const response = await requestIngest(rawBody, {
      "x-opswatch-timestamp": signed.timestamp,
      "x-opswatch-nonce": signed.nonce,
      "x-opswatch-signature": signed.signature
    });

    expect(response.status).toBe(202);
    expect(mockNonceCreate).toHaveBeenCalledOnce();
  });

  it("returns 409 for reused nonces", async () => {
    mockNonceCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test"
      })
    );
    const rawBody = JSON.stringify({ projectSlug, type: "SERVICE_DOWN", severity: "HIGH", source: "test", message: "down" });
    const signed = signBody(rawBody, { nonce: "reused-nonce" });

    const response = await requestIngest(rawBody, {
      "x-opswatch-timestamp": signed.timestamp,
      "x-opswatch-nonce": signed.nonce,
      "x-opswatch-signature": signed.signature
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Replayed ingest request",
      code: INGEST_ERROR_CODES.REPLAY
    });
  });

  it("rejects tampered raw body bytes after signing", async () => {
    const signedBody = JSON.stringify({ projectSlug, type: "SERVICE_DOWN", severity: "HIGH", source: "test", message: "down" });
    const signed = signBody(signedBody);
    const tamperedBody = JSON.stringify({ projectSlug, type: "SERVICE_DOWN", severity: "HIGH", source: "test", message: "changed" });

    const response = await requestIngest(tamperedBody, {
      "x-opswatch-timestamp": signed.timestamp,
      "x-opswatch-nonce": signed.nonce,
      "x-opswatch-signature": signed.signature
    });

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe(INGEST_ERROR_CODES.AUTH_INVALID);
  });
});
