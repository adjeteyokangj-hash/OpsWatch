/**
 * Phase 3 feature-flag matrix + runtime journey (test-labelled local data only).
 * Does not push or start Phase 4.
 */
import { createHash, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { config } from "dotenv";

config({ path: path.resolve(process.cwd(), "apps/api/.env") });

const outDir = path.resolve(process.cwd(), "test-artifacts/phase3-browser");
fs.mkdirSync(outDir, { recursive: true });

const report: Record<string, unknown> = { steps: [] as unknown[] };
const log = (step: string, detail: unknown) => {
  (report.steps as unknown[]).push({ step, detail, at: new Date().toISOString() });
  console.log(`[otel-runtime] ${step}`, detail);
};

async function main() {
  const { prisma } = await import("../apps/api/src/lib/prisma");
  const { ingestOtelBridgePayload } = await import(
    "../apps/api/src/services/otel/otel-ingest.service"
  );
  const { processOtelBatch } = await import("../apps/api/src/services/otel/otel-process.service");
  const { processOtelFreshness } = await import(
    "../apps/api/src/services/otel/otel-freshness.service"
  );
  const { runIncidentCorrelationJob } = await import(
    "../apps/worker/src/jobs/run-incident-correlation.job"
  );

  const organizationId = randomUUID();
  const projectId = randomUUID();
  const connectionId = randomUUID();
  const serviceId = randomUUID();
  const peerServiceId = randomUUID();

  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "TEST ONLY — otel runtime",
      slug: `test-otel-runtime-${organizationId}`,
      updatedAt: new Date()
    }
  });
  await prisma.project.create({
    data: {
      id: projectId,
      name: "TEST ONLY — otel runtime project",
      slug: `test-otel-runtime-${projectId}`,
      clientName: "TEST ONLY",
      environment: "testing",
      apiKey: randomUUID(),
      signingSecret: "otel-runtime-signing",
      organizationId,
      updatedAt: new Date()
    }
  });
  await prisma.service.createMany({
    data: [
      {
        id: serviceId,
        projectId,
        name: "document-api",
        type: "API",
        status: "HEALTHY",
        updatedAt: new Date()
      },
      {
        id: peerServiceId,
        projectId,
        name: "documents-db",
        type: "DATABASE",
        status: "HEALTHY",
        updatedAt: new Date()
      }
    ]
  });
  await prisma.connection.create({
    data: {
      id: connectionId,
      organizationId,
      projectId,
      name: "TEST ONLY otel runtime collector",
      type: "COLLECTOR",
      mode: "OTEL_COLLECTOR",
      environment: "staging",
      authMethod: "API_KEY",
      configurationJson: { serviceName: "document-api" },
      isActive: true,
      updatedAt: new Date()
    }
  });

  const failingPayload = {
    resource: { serviceName: "document-api", deploymentEnvironment: "staging" },
    signals: [
      {
        kind: "METRIC" as const,
        name: "http.server.error_rate",
        value: 0.2,
        timestamp: new Date().toISOString()
      },
      {
        kind: "SPAN" as const,
        name: "db.query",
        severity: "HIGH" as const,
        traceId: "c".repeat(32),
        spanId: "d".repeat(16),
        attributes: {
          "db.system": "postgresql",
          "peer.service": "documents-db"
        },
        timestamp: new Date().toISOString()
      }
    ]
  };

  // 1) Ingestion on, alerts off
  process.env.OPSWATCH_OTEL_INGESTION_ENABLED = "true";
  process.env.OPSWATCH_OTEL_ALERT_GENERATION_ENABLED = "false";
  process.env.OPSWATCH_OTEL_TOPOLOGY_DISCOVERY_ENABLED = "true";
  process.env.OPSWATCH_OTEL_INCIDENT_CORRELATION_ENABLED = "false";

  const batchA = await ingestOtelBridgePayload(
    {
      id: connectionId,
      organizationId,
      projectId,
      name: "TEST ONLY otel runtime collector",
      environment: "staging"
    },
    failingPayload,
    {
      rawBody: Buffer.from(JSON.stringify({ ...failingPayload, nonce: "a" })),
      protocol: "NORMALIZED_JSON"
    }
  );
  await processOtelBatch(batchA.batchId);
  const alertsOff = await prisma.alert.count({
    where: { projectId, sourceType: "OTEL_POLICY" }
  });
  const signalsStored = await prisma.normalizedOperationalSignal.count({
    where: { organizationId }
  });
  log("flag-matrix-ingest-only", {
    signalsStored,
    alertsCreated: alertsOff,
    note: "signals stored, no alert when alert generation disabled"
  });
  if (alertsOff !== 0) throw new Error("Expected no alerts when alert generation disabled");

  // 2) Alerts on, incident correlation off
  process.env.OPSWATCH_OTEL_ALERT_GENERATION_ENABLED = "true";
  process.env.OPSWATCH_OTEL_INCIDENT_CORRELATION_ENABLED = "false";
  const payloadB = {
    ...failingPayload,
    signals: failingPayload.signals.map((s) => ({
      ...s,
      timestamp: new Date().toISOString()
    }))
  };
  const batchB = await ingestOtelBridgePayload(
    {
      id: connectionId,
      organizationId,
      projectId,
      name: "TEST ONLY otel runtime collector",
      environment: "staging"
    },
    payloadB,
    {
      rawBody: Buffer.from(JSON.stringify({ ...payloadB, nonce: "b" })),
      protocol: "NORMALIZED_JSON"
    }
  );
  await processOtelBatch(batchB.batchId);
  const alertsOn = await prisma.alert.count({
    where: { projectId, sourceType: "OTEL_POLICY", status: { in: ["OPEN", "ACKNOWLEDGED"] } }
  });
  await runIncidentCorrelationJob();
  const otelIncidentEvidenceOff = await prisma.otelIncidentEvidence.count({
    where: { organizationId }
  });
  log("flag-matrix-alerts-without-incident-correlation", {
    alertsCreated: alertsOn,
    otelIncidentEvidence: otelIncidentEvidenceOff,
    note: "alerts created; OTEL incident evidence gated off"
  });
  if (alertsOn < 1) throw new Error("Expected OTEL alerts when alert generation enabled");
  if (otelIncidentEvidenceOff !== 0) {
    throw new Error("Expected no OtelIncidentEvidence when incident correlation disabled");
  }

  // 3) All flags on — complete path
  process.env.OPSWATCH_OTEL_INCIDENT_CORRELATION_ENABLED = "true";
  await runIncidentCorrelationJob();
  const otelIncidentEvidenceOn = await prisma.otelIncidentEvidence.count({
    where: { organizationId }
  });
  const entities = await prisma.operationalEntity.count({
    where: { organizationId, discoverySource: "OTEL_BRIDGE" }
  });
  const relationships = await prisma.operationalRelationship.count({
    where: { organizationId, provenance: "OTEL_COLLECTOR" }
  });
  log("flag-matrix-all-enabled", {
    otelIncidentEvidence: otelIncidentEvidenceOn,
    entities,
    relationships
  });
  if (otelIncidentEvidenceOn < 1) {
    throw new Error("Expected OtelIncidentEvidence when all OTEL flags enabled");
  }
  if (entities < 1 || relationships < 1) {
    throw new Error("Expected discovered entities and relationships");
  }

  // Healthy follow-up (recovery path via policy hysteresis may not fully resolve in one sample)
  const healthyPayload = {
    resource: { serviceName: "document-api", deploymentEnvironment: "staging" },
    signals: [
      {
        kind: "METRIC" as const,
        name: "http.server.error_rate",
        value: 0,
        timestamp: new Date().toISOString()
      }
    ]
  };
  const batchHealthy = await ingestOtelBridgePayload(
    {
      id: connectionId,
      organizationId,
      projectId,
      name: "TEST ONLY otel runtime collector",
      environment: "staging"
    },
    healthyPayload,
    {
      rawBody: Buffer.from(JSON.stringify({ ...healthyPayload, nonce: "healthy" })),
      protocol: "NORMALIZED_JSON"
    }
  );
  await processOtelBatch(batchHealthy.batchId);
  log("healthy-followup", { batchId: batchHealthy.batchId, accepted: batchHealthy.accepted });

  // Stale → Unknown
  await prisma.operationalEntity.updateMany({
    where: { organizationId, discoverySource: "OTEL_BRIDGE" },
    data: { freshUntil: new Date(Date.now() - 60_000), discoveryState: "ACTIVE" }
  });
  const freshness = await processOtelFreshness();
  const stale = await prisma.operationalEntity.findFirst({
    where: { organizationId, discoveryState: "STALE" }
  });
  log("stale-unknown", {
    freshness,
    staleHealth: stale?.health,
    hash: createHash("sha256").update(String(stale?.id ?? "")).digest("hex").slice(0, 8)
  });
  if (stale?.health !== "UNKNOWN") throw new Error("Expected stale entity health UNKNOWN");

  report.result = "PASS";
  fs.writeFileSync(path.join(outDir, "runtime-journey.json"), JSON.stringify(report, null, 2));

  // Cleanup
  await prisma.otelIncidentEvidence.deleteMany({ where: { organizationId } });
  await prisma.otelAlertEvidence.deleteMany({ where: { organizationId } });
  await prisma.incidentAlert.deleteMany({
    where: { Incident: { projectId } }
  });
  await prisma.incident.deleteMany({ where: { projectId } });
  await prisma.alert.deleteMany({ where: { projectId } });
  await prisma.normalizedOperationalSignal.deleteMany({ where: { organizationId } });
  await prisma.otelIngestBatch.deleteMany({ where: { organizationId } });
  await prisma.operationalRelationship.deleteMany({ where: { organizationId } });
  await prisma.operationalEntity.deleteMany({ where: { organizationId } });
  await prisma.operationalObservation.deleteMany({ where: { organizationId } });
  await prisma.operationsTimelineEvent.deleteMany({ where: { organizationId } });
  await prisma.serviceDependency.deleteMany({ where: { projectId } });
  await prisma.connection.deleteMany({ where: { id: connectionId } });
  await prisma.service.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
  await prisma.$disconnect();
}

main().catch(async (error) => {
  report.result = "FAIL";
  report.error = error instanceof Error ? error.message : String(error);
  fs.writeFileSync(path.join(outDir, "runtime-journey.json"), JSON.stringify(report, null, 2));
  console.error(error);
  process.exit(1);
});
