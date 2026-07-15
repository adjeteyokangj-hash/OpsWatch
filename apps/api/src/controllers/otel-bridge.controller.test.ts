import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { computeIngestSignature } from "../lib/request-signature";

const mocks = vi.hoisted(() => ({
  connectionFindFirst: vi.fn(),
  connectionUpdate: vi.fn(),
  nonceCreate: vi.fn(),
  auditCreate: vi.fn(),
  serviceFindFirst: vi.fn(),
  entityUpsert: vi.fn(),
  observationCreate: vi.fn(),
  timelineCreate: vi.fn()
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    connection: { findFirst: mocks.connectionFindFirst, update: mocks.connectionUpdate },
    ingestReplayNonce: { create: mocks.nonceCreate },
    auditLog: { create: mocks.auditCreate },
    service: { findFirst: mocks.serviceFindFirst },
    operationalEntity: { upsert: mocks.entityUpsert },
    operationalObservation: { create: mocks.observationCreate },
    operationsTimelineEvent: { create: mocks.timelineCreate }
  }
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
  secretRef: "env://OTEL_BRIDGE_TEST_SECRET"
};

describe("OpenTelemetry bridge controller", () => {
  it("refuses ingestion while the feature gate is disabled", async () => {
    delete process.env.OPSWATCH_OTEL_INGESTION_ENABLED;
    const res = response();
    await ingestOtelBridge({ params: { connectionId: "connection-a" }, header: vi.fn(), body: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "OTEL_INGESTION_DISABLED" }));
    expect(mocks.connectionFindFirst).not.toHaveBeenCalled();
  });

  it("rejects unsigned collector requests after locating only the requested connection", async () => {
    process.env.OPSWATCH_OTEL_INGESTION_ENABLED = "true";
    process.env.OTEL_BRIDGE_TEST_SECRET = "bridge-secret";
    mocks.connectionFindFirst.mockResolvedValueOnce(connection);
    const res = response();
    await ingestOtelBridge({
      params: { connectionId: "connection-a" },
      header: vi.fn(),
      rawBody: Buffer.from(JSON.stringify({ resource: { serviceName: "document-api" }, signals: [{ kind: "LOG", name: "log" }] })),
      body: {}
    } as any, res as any);
    expect(mocks.connectionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "connection-a", mode: "OTEL_COLLECTOR", isActive: true }
    }));
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects replayed signed batches before creating telemetry entities", async () => {
    process.env.OPSWATCH_OTEL_INGESTION_ENABLED = "true";
    process.env.OTEL_BRIDGE_TEST_SECRET = "bridge-secret";
    const body = JSON.stringify({ resource: { serviceName: "document-api" }, signals: [{ kind: "SPAN", name: "upload" }] });
    const timestamp = new Date().toISOString();
    const nonce = "replayed-batch";
    mocks.connectionFindFirst.mockResolvedValueOnce(connection);
    mocks.nonceCreate.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" }));
    const headers: Record<string, string> = {
      "x-opswatch-timestamp": timestamp,
      "x-opswatch-nonce": nonce,
      "x-opswatch-signature": computeIngestSignature("bridge-secret", timestamp, nonce, Buffer.from(body))
    };
    const res = response();
    await ingestOtelBridge({
      params: { connectionId: "connection-a" },
      header: (name: string) => headers[name],
      rawBody: Buffer.from(body),
      body: JSON.parse(body)
    } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mocks.entityUpsert).not.toHaveBeenCalled();
  });

  it("returns a contract error for a non-object signal", async () => {
    process.env.OPSWATCH_OTEL_INGESTION_ENABLED = "true";
    process.env.OTEL_BRIDGE_TEST_SECRET = "bridge-secret";
    const body = JSON.stringify({ resource: { serviceName: "document-api" }, signals: [null] });
    const timestamp = new Date().toISOString();
    const nonce = "invalid-signal-batch";
    mocks.connectionFindFirst.mockResolvedValueOnce(connection);
    mocks.nonceCreate.mockResolvedValueOnce({ nonce });
    const headers: Record<string, string> = {
      "x-opswatch-timestamp": timestamp,
      "x-opswatch-nonce": nonce,
      "x-opswatch-signature": computeIngestSignature("bridge-secret", timestamp, nonce, Buffer.from(body))
    };
    const res = response();
    await ingestOtelBridge({
      params: { connectionId: "connection-a" },
      header: (name: string) => headers[name],
      rawBody: Buffer.from(body),
      body: JSON.parse(body)
    } as any, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: "OTEL_CONTRACT_INVALID",
      error: "each signal must be an object"
    }));
    expect(mocks.entityUpsert).not.toHaveBeenCalled();
  });

  it("maps accepted telemetry to the authenticated connection organization", async () => {
    process.env.OPSWATCH_OTEL_INGESTION_ENABLED = "true";
    process.env.OTEL_BRIDGE_TEST_SECRET = "bridge-secret";
    const body = JSON.stringify({
      resource: { serviceName: "document-api", deploymentEnvironment: "staging" },
      signals: [{ kind: "LOG", name: "document.saved", body: "document 42 saved", attributes: { "http.method": "POST" } }]
    });
    const timestamp = new Date().toISOString();
    const nonce = "unique-batch";
    mocks.connectionFindFirst.mockResolvedValueOnce(connection);
    mocks.nonceCreate.mockResolvedValueOnce({ nonce });
    mocks.serviceFindFirst.mockResolvedValueOnce({ id: "service-a" });
    mocks.entityUpsert.mockResolvedValueOnce({ id: "entity-a" });
    const headers: Record<string, string> = {
      "x-opswatch-timestamp": timestamp,
      "x-opswatch-nonce": nonce,
      "x-opswatch-signature": computeIngestSignature("bridge-secret", timestamp, nonce, Buffer.from(body))
    };
    const res = response();
    await ingestOtelBridge({
      params: { connectionId: "connection-a" },
      header: (name: string) => headers[name],
      rawBody: Buffer.from(body),
      body: JSON.parse(body)
    } as any, res as any);

    expect(mocks.entityUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId_entityType_externalId: expect.objectContaining({ organizationId: "org-a" })
      }),
      create: expect.objectContaining({ organizationId: "org-a", projectId: "project-a" })
    }));
    expect(res.status).toHaveBeenCalledWith(202);
  });
});
