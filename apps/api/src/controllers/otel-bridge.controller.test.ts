import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeIngestSignature } from "../lib/request-signature";

const mocks = vi.hoisted(() => ({
  connectionFindFirst: vi.fn(),
  nonceCreate: vi.fn(),
  auditCreate: vi.fn(),
  otelBatchFindUnique: vi.fn(),
  ingestOtelBridgePayload: vi.fn(),
  processOtelBatch: vi.fn(),
  resolveIngestSecrets: vi.fn(),
  recordConnectionCredentialProbe: vi.fn()
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    connection: { findFirst: mocks.connectionFindFirst },
    ingestReplayNonce: { create: mocks.nonceCreate },
    auditLog: { create: mocks.auditCreate },
    otelIngestBatch: { findUnique: mocks.otelBatchFindUnique }
  }
}));

vi.mock("../services/otel-bridge.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/otel-bridge.service")>();
  return {
    ...actual,
    ingestOtelBridgePayload: mocks.ingestOtelBridgePayload
  };
});

vi.mock("../services/otel/otel-process.service", () => ({
  processOtelBatch: mocks.processOtelBatch
}));

vi.mock("../services/credentials/connection-credential.service", () => ({
  resolveIngestSecrets: mocks.resolveIngestSecrets,
  recordConnectionCredentialProbe: mocks.recordConnectionCredentialProbe
}));

import { ingestOtelBridge } from "./otel-bridge.controller";

const response = () => {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { status, json };
};

const connection = {
  id: "connection-a",
  organizationId: "org-a",
  projectId: "project-a",
  name: "Document platform collector",
  environment: "staging",
  configurationJson: { serviceName: "document-api" },
  credentialFamilyId: null,
  secretRef: "env://OTEL_BRIDGE_TEST_SECRET",
  managedSecretCiphertext: null,
  managedSecretIv: null,
  managedSecretAuthTag: null
};

describe("OpenTelemetry bridge controller", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.OPSWATCH_OTEL_INGESTION_ENABLED;
  });

  it("refuses ingestion while the feature gate is disabled", async () => {
    delete process.env.OPSWATCH_OTEL_INGESTION_ENABLED;
    const res = response();
    await ingestOtelBridge(
      {
        params: { connectionId: "connection-a" },
        header: vi.fn(),
        rawBody: Buffer.from("{}"),
        body: {}
      } as any,
      res as any
    );
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "OTEL_INGESTION_DISABLED", features: expect.any(Object) })
    );
    expect(mocks.connectionFindFirst).not.toHaveBeenCalled();
  });

  it("rejects unsigned collector requests after locating only the requested connection", async () => {
    process.env.OPSWATCH_OTEL_INGESTION_ENABLED = "true";
    mocks.connectionFindFirst.mockResolvedValueOnce(connection);
    mocks.resolveIngestSecrets.mockResolvedValueOnce(["bridge-secret"]);
    const res = response();
    await ingestOtelBridge(
      {
        params: { connectionId: "connection-a" },
        header: vi.fn(),
        rawBody: Buffer.from(
          JSON.stringify({
            resource: { serviceName: "document-api" },
            signals: [{ kind: "LOG", name: "log" }]
          })
        ),
        body: {}
      } as any,
      res as any
    );
    expect(mocks.connectionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "connection-a", mode: "OTEL_COLLECTOR", isActive: true }
      })
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("does not consume nonce before contract validation fails", async () => {
    process.env.OPSWATCH_OTEL_INGESTION_ENABLED = "true";
    const body = JSON.stringify({
      resource: { serviceName: "document-api", deploymentEnvironment: "staging" },
      signals: [null]
    });
    const timestamp = new Date().toISOString();
    const nonce = "invalid-signal-batch";
    mocks.connectionFindFirst.mockResolvedValueOnce(connection);
    mocks.resolveIngestSecrets.mockResolvedValueOnce(["bridge-secret"]);
    const headers: Record<string, string> = {
      "x-opswatch-timestamp": timestamp,
      "x-opswatch-nonce": nonce,
      "x-opswatch-signature": computeIngestSignature(
        "bridge-secret",
        timestamp,
        nonce,
        Buffer.from(body)
      )
    };
    const res = response();
    await ingestOtelBridge(
      {
        params: { connectionId: "connection-a" },
        header: (name: string) => headers[name],
        rawBody: Buffer.from(body),
        body: JSON.parse(body)
      } as any,
      res as any
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.nonceCreate).not.toHaveBeenCalled();
    expect(mocks.ingestOtelBridgePayload).not.toHaveBeenCalled();
  });

  it("rejects replayed signed batches after identity validation", async () => {
    process.env.OPSWATCH_OTEL_INGESTION_ENABLED = "true";
    const body = JSON.stringify({
      resource: { serviceName: "document-api", deploymentEnvironment: "staging" },
      signals: [{ kind: "SPAN", name: "upload", traceId: "a".repeat(32), spanId: "b".repeat(16) }]
    });
    const timestamp = new Date().toISOString();
    const nonce = "replayed-batch";
    mocks.connectionFindFirst.mockResolvedValueOnce(connection);
    mocks.resolveIngestSecrets.mockResolvedValueOnce(["bridge-secret"]);
    mocks.nonceCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "test"
      })
    );
    const headers: Record<string, string> = {
      "x-opswatch-timestamp": timestamp,
      "x-opswatch-nonce": nonce,
      "x-opswatch-signature": computeIngestSignature(
        "bridge-secret",
        timestamp,
        nonce,
        Buffer.from(body)
      )
    };
    const res = response();
    await ingestOtelBridge(
      {
        params: { connectionId: "connection-a" },
        header: (name: string) => headers[name],
        rawBody: Buffer.from(body),
        body: JSON.parse(body)
      } as any,
      res as any
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mocks.ingestOtelBridgePayload).not.toHaveBeenCalled();
  });

  it("rejects auth when managed credential family resolves empty", async () => {
    process.env.OPSWATCH_OTEL_INGESTION_ENABLED = "true";
    mocks.connectionFindFirst.mockResolvedValueOnce({
      ...connection,
      credentialFamilyId: "family-1",
      secretRef: "env://OTEL_BRIDGE_TEST_SECRET"
    });
    mocks.resolveIngestSecrets.mockResolvedValueOnce([]);
    const res = response();
    await ingestOtelBridge(
      {
        params: { connectionId: "connection-a" },
        header: vi.fn().mockReturnValue("unused"),
        rawBody: Buffer.from("{}"),
        body: {}
      } as any,
      res as any
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mocks.recordConnectionCredentialProbe).toHaveBeenCalledWith(
      expect.objectContaining({ credentialFamilyId: "family-1" }),
      { succeeded: false }
    );
  });

  it("accepts a valid batch and returns feature flags", async () => {
    process.env.OPSWATCH_OTEL_INGESTION_ENABLED = "true";
    const body = JSON.stringify({
      resource: { serviceName: "document-api", deploymentEnvironment: "staging" },
      signals: [
        {
          kind: "LOG",
          name: "document.saved",
          body: "document 42 saved",
          attributes: { "http.method": "POST" }
        }
      ]
    });
    const timestamp = new Date().toISOString();
    const nonce = "unique-batch";
    mocks.connectionFindFirst.mockResolvedValueOnce(connection);
    mocks.resolveIngestSecrets.mockResolvedValueOnce(["bridge-secret"]);
    mocks.nonceCreate.mockResolvedValueOnce({ nonce });
    mocks.ingestOtelBridgePayload.mockResolvedValueOnce({
      batchId: "batch-a",
      entityId: "entity-a",
      accepted: 1,
      rejected: [],
      duplicate: false,
      status: "PENDING"
    });
    mocks.processOtelBatch.mockResolvedValueOnce({ processed: 1, failed: 0 });
    mocks.otelBatchFindUnique.mockResolvedValueOnce({ status: "COMPLETED" });
    const headers: Record<string, string> = {
      "x-opswatch-timestamp": timestamp,
      "x-opswatch-nonce": nonce,
      "x-opswatch-signature": computeIngestSignature(
        "bridge-secret",
        timestamp,
        nonce,
        Buffer.from(body)
      )
    };
    const res = response();
    await ingestOtelBridge(
      {
        params: { connectionId: "connection-a" },
        header: (name: string) => headers[name],
        rawBody: Buffer.from(body),
        body: JSON.parse(body)
      } as any,
      res as any
    );

    expect(mocks.nonceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          connectionId: "connection-a",
          nonce: expect.stringContaining("connection-a")
        })
      })
    );
    expect(mocks.processOtelBatch).toHaveBeenCalledWith("batch-a");
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        accepted: true,
        batchId: "batch-a",
        entityId: "entity-a",
        features: expect.objectContaining({ ingestion: true })
      })
    );
  });
});
