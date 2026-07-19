import { randomUUID } from "crypto";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env" });
const enabled = process.env.RUN_DATABASE_E2E === "true";

describe.runIf(enabled)("OTEL operational spine database e2e", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let ingestOtelBridgePayload: typeof import("./otel-ingest.service").ingestOtelBridgePayload;
  let processOtelBatch: typeof import("./otel-process.service").processOtelBatch;
  let processOtelFreshness: typeof import("./otel-freshness.service").processOtelFreshness;

  const organizationId = randomUUID();
  const projectId = randomUUID();
  const connectionId = randomUUID();
  const serviceId = randomUUID();

  beforeAll(async () => {
    process.env.OPSWATCH_OTEL_INGESTION_ENABLED = "true";
    process.env.OPSWATCH_OTEL_TOPOLOGY_DISCOVERY_ENABLED = "true";
    process.env.OPSWATCH_OTEL_ALERT_GENERATION_ENABLED = "true";
    process.env.OPSWATCH_OTEL_INCIDENT_CORRELATION_ENABLED = "true";

    ({ prisma } = await import("../../lib/prisma"));
    ({ ingestOtelBridgePayload } = await import("./otel-ingest.service"));
    ({ processOtelBatch } = await import("./otel-process.service"));
    ({ processOtelFreshness } = await import("./otel-freshness.service"));

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "TEST ONLY — otel spine",
        slug: `test-otel-${organizationId}`,
        updatedAt: new Date()
      }
    });
    await prisma.project.create({
      data: {
        id: projectId,
        name: "TEST ONLY — otel project",
        slug: `test-otel-project-${projectId}`,
        clientName: "TEST ONLY",
        environment: "testing",
        apiKey: randomUUID(),
        signingSecret: "otel-e2e-signing-secret",
        organizationId,
        updatedAt: new Date()
      }
    });
    await prisma.service.create({
      data: {
        id: serviceId,
        projectId,
        name: "document-api",
        type: "API",
        status: "HEALTHY",
        updatedAt: new Date()
      }
    });
    await prisma.connection.create({
      data: {
        id: connectionId,
        organizationId,
        projectId,
        name: "TEST ONLY otel collector",
        type: "COLLECTOR",
        mode: "OTEL_COLLECTOR",
        environment: "staging",
        authMethod: "HMAC",
        configurationJson: { serviceName: "document-api" },
        isActive: true,
        updatedAt: new Date()
      }
    });
  });

  afterAll(async () => {
    await prisma.otelIncidentEvidence.deleteMany({ where: { organizationId } });
    await prisma.otelAlertEvidence.deleteMany({ where: { organizationId } });
    await prisma.alert.deleteMany({ where: { projectId } });
    await prisma.normalizedOperationalSignal.deleteMany({ where: { organizationId } });
    await prisma.otelMetricWindow.deleteMany({ where: { organizationId } });
    await prisma.otelIngestBatch.deleteMany({ where: { organizationId } });
    await prisma.operationalRelationship.deleteMany({ where: { organizationId } });
    await prisma.operationalEntity.deleteMany({ where: { organizationId } });
    await prisma.operationalObservation.deleteMany({ where: { organizationId } });
    await prisma.operationsTimelineEvent.deleteMany({ where: { organizationId } });
    await prisma.connection.deleteMany({ where: { id: connectionId } });
    await prisma.service.deleteMany({ where: { id: serviceId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });

  it("ingests, normalizes, alerts, and marks stale without healthy recovery", async () => {
    const payload = {
      resource: {
        serviceName: "document-api",
        deploymentEnvironment: "staging"
      },
      signals: [
        {
          kind: "METRIC" as const,
          name: "http.server.error_rate",
          value: 0.12,
          timestamp: new Date().toISOString()
        },
        {
          kind: "SPAN" as const,
          name: "db.query",
          severity: "HIGH" as const,
          traceId: "a".repeat(32),
          spanId: "b".repeat(16),
          attributes: {
            "db.system": "postgresql",
            "db.name": "documents",
            "peer.service": "documents-db"
          }
        }
      ]
    };

    const first = await ingestOtelBridgePayload(
      {
        id: connectionId,
        organizationId,
        projectId,
        name: "TEST ONLY otel collector",
        environment: "staging"
      },
      payload,
      { rawBody: Buffer.from(JSON.stringify(payload)), protocol: "NORMALIZED_JSON" }
    );
    expect(first.duplicate).toBe(false);
    expect(first.accepted).toBe(2);

    const processed = await processOtelBatch(first.batchId);
    expect(processed.processed).toBeGreaterThan(0);

    const alerts = await prisma.alert.findMany({
      where: { projectId, sourceType: "OTEL_POLICY" }
    });
    expect(alerts.length).toBeGreaterThan(0);
    const evidence = await prisma.otelAlertEvidence.count({
      where: { organizationId, alertId: { in: alerts.map((row) => row.id) } }
    });
    expect(evidence).toBeGreaterThan(0);

    const duplicate = await ingestOtelBridgePayload(
      {
        id: connectionId,
        organizationId,
        projectId,
        name: "TEST ONLY otel collector",
        environment: "staging"
      },
      payload,
      { rawBody: Buffer.from(JSON.stringify(payload)), protocol: "NORMALIZED_JSON" }
    );
    expect(duplicate.duplicate).toBe(true);

    await prisma.operationalEntity.updateMany({
      where: { organizationId, discoverySource: "OTEL_BRIDGE" },
      data: { freshUntil: new Date(Date.now() - 60_000), discoveryState: "ACTIVE" }
    });
    const freshness = await processOtelFreshness();
    expect(freshness.staleEntities).toBeGreaterThan(0);
    const staleEntity = await prisma.operationalEntity.findFirst({
      where: { organizationId, discoveryState: "STALE" }
    });
    expect(staleEntity?.health).toBe("UNKNOWN");
  });
});
