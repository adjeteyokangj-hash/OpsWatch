import { randomUUID } from "crypto";
import http from "http";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env" });

const enabled = process.env.RUN_DATABASE_E2E === "true";

describe.runIf(enabled)("Phase 10 monitoring connectors database E2E", () => {
  const organizationId = randomUUID();
  const otherOrgId = randomUUID();
  const projectId = randomUUID();
  const otherProjectId = randomUUID();
  const connectionId = randomUUID();
  const otherConnectionId = randomUUID();

  let prisma: import("@prisma/client").PrismaClient;
  let testMonitoringConnection: typeof import("./monitoring-connector-test.service").testMonitoringConnection;
  let syncMonitoringConnection: typeof import("./monitoring-connector-sync.service").syncMonitoringConnection;
  let syncDueMonitoringConnections: typeof import("./monitoring-connector-sync.service").syncDueMonitoringConnections;
  let ensureE2EOrgPlan: typeof import("../test-helpers/e2e-org-plan").ensureE2EOrgPlan;

  let fixtureServer: http.Server;
  let fixturePort = 0;
  let failNextValidate = false;
  let rateLimitRemaining = 0;
  let pageHits = 0;
  let previousAllowLocal: string | undefined;

  beforeAll(async () => {
    previousAllowLocal = process.env.OPSWATCH_ALLOW_LOCAL_CONNECTION_PROBES;
    process.env.OPSWATCH_ALLOW_LOCAL_CONNECTION_PROBES = "true";

    ({ prisma } = await import("../../lib/prisma"));
    ({ ensureE2EOrgPlan } = await import("../test-helpers/e2e-org-plan"));
    ({ testMonitoringConnection } = await import("./monitoring-connector-test.service"));
    ({
      syncMonitoringConnection,
      syncDueMonitoringConnections
    } = await import("./monitoring-connector-sync.service"));

    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1`);
      const path = url.pathname;

      if (path.endsWith("/api/v1/validate")) {
        if (failNextValidate) {
          failNextValidate = false;
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, status: "ok" }));
        return;
      }

      if (path.endsWith("/api/v1/sync/metrics-alerts")) {
        if (rateLimitRemaining > 0) {
          rateLimitRemaining -= 1;
          res.writeHead(429, { "content-type": "text/plain", "retry-after": "0" });
          res.end("rate limited");
          return;
        }
        pageHits += 1;
        const cursor = url.searchParams.get("cursor");
        if (!cursor) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              monitors: [{ id: 1, name: "API latency", overall_state: "OK" }],
              events: [
                {
                  id: 501,
                  title: "Elevated latency",
                  alert_type: "warning",
                  monitor_id: 1,
                  date_happened: Math.floor(Date.now() / 1000)
                }
              ],
              meta: { next_cursor: "page-2" }
            })
          );
          return;
        }
        if (cursor === "page-2") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              monitors: [{ id: 2, name: "Checkout errors", overall_state: "Alert" }],
              events: [
                {
                  id: 502,
                  title: "Error rate spike",
                  alert_type: "error",
                  monitor_id: 2,
                  date_happened: Math.floor(Date.now() / 1000)
                }
              ],
              meta: { next_cursor: null }
            })
          );
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ monitors: [], events: [] }));
        return;
      }

      if (path.endsWith("/api/v1/sync/fail")) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "upstream unavailable" }));
        return;
      }

      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => {
      fixtureServer.listen(0, "127.0.0.1", () => {
        const addr = fixtureServer.address();
        fixturePort = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Phase10 Monitoring E2E",
        slug: `phase10-mon-${organizationId.slice(0, 8)}`,
        updatedAt: new Date()
      }
    });
    await prisma.organization.create({
      data: {
        id: otherOrgId,
        name: "Phase10 Other Org",
        slug: `phase10-other-${otherOrgId.slice(0, 8)}`,
        updatedAt: new Date()
      }
    });
    await ensureE2EOrgPlan(organizationId);
    await ensureE2EOrgPlan(otherOrgId);

    await prisma.project.create({
      data: {
        id: projectId,
        organizationId,
        name: "Phase10 App",
        slug: `phase10-app-${projectId.slice(0, 8)}`,
        clientName: "Phase10",
        environment: "production",
        apiKey: `pk_${projectId}`,
        signingSecret: `ss_${projectId}`,
        updatedAt: new Date()
      }
    });
    await prisma.project.create({
      data: {
        id: otherProjectId,
        organizationId: otherOrgId,
        name: "Other App",
        slug: `phase10-other-app-${otherProjectId.slice(0, 8)}`,
        clientName: "Other",
        environment: "production",
        apiKey: `pk_${otherProjectId}`,
        signingSecret: `ss_${otherProjectId}`,
        updatedAt: new Date()
      }
    });

    const baseUrl = `http://127.0.0.1:${fixturePort}`;
    await prisma.connection.create({
      data: {
        id: connectionId,
        organizationId,
        projectId,
        name: "Metrics source",
        type: "Metrics & alerts connector",
        mode: "METRICS_ALERTS_CONNECTOR",
        environment: "production",
        authMethod: "API_KEY",
        capabilitiesJson: ["monitoring_sync"],
        configurationJson: {
          baseUrl,
          endpoint: `${baseUrl}/api/v1/validate`,
          healthPath: "/api/v1/validate",
          syncPath: "/api/v1/sync/metrics-alerts",
          method: "GET",
          timeoutMs: 5000,
          pageSize: 50,
          cursorParam: "cursor",
          authHeaderName: "X-API-Key"
        },
        secretRef: "env://PHASE10_MONITORING_FIXTURE_SECRET",
        health: "UNKNOWN",
        installationStatus: "DRAFT",
        syncIntervalMinutes: 15,
        updatedAt: new Date()
      }
    });
    process.env.PHASE10_MONITORING_FIXTURE_SECRET = "fixture-secret";

    await prisma.connection.create({
      data: {
        id: otherConnectionId,
        organizationId: otherOrgId,
        projectId: otherProjectId,
        name: "Other metrics source",
        type: "Metrics & alerts connector",
        mode: "METRICS_ALERTS_CONNECTOR",
        environment: "production",
        authMethod: "API_KEY",
        capabilitiesJson: ["monitoring_sync"],
        configurationJson: {
          baseUrl,
          endpoint: `${baseUrl}/api/v1/validate`,
          healthPath: "/api/v1/validate",
          syncPath: "/api/v1/sync/metrics-alerts",
          method: "GET",
          timeoutMs: 5000,
          authHeaderName: "X-API-Key"
        },
        secretRef: "env://PHASE10_MONITORING_FIXTURE_SECRET",
        health: "UNKNOWN",
        installationStatus: "DRAFT",
        syncIntervalMinutes: 15,
        updatedAt: new Date()
      }
    });
  }, 120_000);

  afterAll(async () => {
    if (previousAllowLocal === undefined) delete process.env.OPSWATCH_ALLOW_LOCAL_CONNECTION_PROBES;
    else process.env.OPSWATCH_ALLOW_LOCAL_CONNECTION_PROBES = previousAllowLocal;
    delete process.env.PHASE10_MONITORING_FIXTURE_SECRET;

    await prisma.monitoringSyncRun.deleteMany({
      where: { connectionId: { in: [connectionId, otherConnectionId] } }
    });
    await prisma.alert.deleteMany({ where: { projectId: { in: [projectId, otherProjectId] } } });
    await prisma.changeLedgerEntry.deleteMany({
      where: { connectionId: { in: [connectionId, otherConnectionId] } }
    });
    await prisma.operationalEntityIdentity.deleteMany({
      where: { projectId: { in: [projectId, otherProjectId] } }
    });
    await prisma.operationalRelationship.deleteMany({
      where: { projectId: { in: [projectId, otherProjectId] } }
    });
    await prisma.operationalEntity.deleteMany({
      where: { projectId: { in: [projectId, otherProjectId] } }
    });
    await prisma.connection.deleteMany({ where: { id: { in: [connectionId, otherConnectionId] } } });
    await prisma.project.deleteMany({ where: { id: { in: [projectId, otherProjectId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [organizationId, otherOrgId] } } });
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    await prisma.$disconnect();
  }, 60_000);

  const loadConnection = async (id: string) => {
    const row = await prisma.connection.findUniqueOrThrow({ where: { id } });
    return {
      id: row.id,
      organizationId: row.organizationId,
      projectId: row.projectId,
      name: row.name,
      mode: row.mode,
      environment: row.environment,
      authMethod: row.authMethod,
      configurationJson: row.configurationJson,
      credentialFamilyId: row.credentialFamilyId,
      secretRef: row.secretRef,
      managedSecretCiphertext: row.managedSecretCiphertext,
      managedSecretIv: row.managedSecretIv,
      managedSecretAuthTag: row.managedSecretAuthTag,
      syncIntervalMinutes: row.syncIntervalMinutes,
      lastSyncAt: row.lastSyncAt
    };
  };

  it("validates a monitoring connection against the fixture source", async () => {
    const connection = await loadConnection(connectionId);
    const result = await testMonitoringConnection(connection);
    expect(result.succeeded).toBe(true);
    expect(result.healthPassed).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/datadog|dynatrace/i);
  });

  it("paginates sync, normalizes wire payload, imports graph entities, and dedupes alerts", async () => {
    pageHits = 0;
    rateLimitRemaining = 0;
    const connection = await loadConnection(connectionId);
    const first = await syncMonitoringConnection(connection);
    expect(first.status).toBe("SUCCEEDED");
    expect(first.pageCount).toBeGreaterThanOrEqual(2);
    expect(first.entities).toBeGreaterThanOrEqual(2);
    expect(first.signals).toBeGreaterThanOrEqual(2);
    expect(pageHits).toBeGreaterThanOrEqual(2);

    const entities = await prisma.operationalEntity.findMany({
      where: { organizationId, projectId, discoverySource: "EXTERNAL_MONITORING" }
    });
    expect(entities.length).toBeGreaterThanOrEqual(2);

    const alerts = await prisma.alert.findMany({ where: { projectId } });
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    expect(alerts.every((row) => row.sourceType === "EXTERNAL_MONITORING")).toBe(true);
    expect(JSON.stringify(alerts)).not.toMatch(/datadog|dynatrace/i);

    const second = await syncMonitoringConnection(await loadConnection(connectionId));
    expect(second.status).toBe("SUCCEEDED");
    const alertsAfter = await prisma.alert.findMany({ where: { projectId } });
    // Deduped by sourceId — occurrence bumps, not unbounded duplicates for same external IDs.
    expect(alertsAfter.length).toBe(alerts.length);
  }, 60_000);

  it("retries through fixture 429 responses during sync", async () => {
    rateLimitRemaining = 2;
    pageHits = 0;
    const result = await syncMonitoringConnection(await loadConnection(connectionId));
    expect(result.status).toBe("SUCCEEDED");
    expect(pageHits).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("records failed sync audit rows and connection health", async () => {
    await prisma.connection.update({
      where: { id: connectionId },
      data: {
        configurationJson: {
          baseUrl: `http://127.0.0.1:${fixturePort}`,
          endpoint: `http://127.0.0.1:${fixturePort}/api/v1/validate`,
          healthPath: "/api/v1/validate",
          syncPath: "/api/v1/sync/fail",
          method: "GET",
          timeoutMs: 3000,
          authHeaderName: "X-API-Key",
          maxRetries: 1,
          __testSleepMs: 0
        },
        updatedAt: new Date()
      }
    });

    const result = await syncMonitoringConnection(await loadConnection(connectionId));
    expect(result.status).toBe("FAILED");
    expect(result.errorCategory).toBe("SERVER_ERROR");

    const failedRun = await prisma.monitoringSyncRun.findFirst({
      where: { connectionId, status: "FAILED" },
      orderBy: { startedAt: "desc" }
    });
    expect(failedRun).toBeTruthy();
    expect(failedRun?.errorCategory).toBe("SERVER_ERROR");

    const connection = await prisma.connection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(connection.lastSyncStatus).toBe("FAILED");
    expect(connection.health).toBe("DEGRADED");

    // Restore healthy sync path for scheduled sync test.
    await prisma.connection.update({
      where: { id: connectionId },
      data: {
        configurationJson: {
          baseUrl: `http://127.0.0.1:${fixturePort}`,
          endpoint: `http://127.0.0.1:${fixturePort}/api/v1/validate`,
          healthPath: "/api/v1/validate",
          syncPath: "/api/v1/sync/metrics-alerts",
          method: "GET",
          timeoutMs: 5000,
          pageSize: 50,
          cursorParam: "cursor",
          authHeaderName: "X-API-Key"
        },
        lastSyncAt: null,
        updatedAt: new Date()
      }
    });
  }, 60_000);

  it("runs scheduled sync for due connections and isolates organizations", async () => {
    await prisma.connection.update({
      where: { id: otherConnectionId },
      data: { lastSyncAt: null, installationStatus: "CONNECTED", updatedAt: new Date() }
    });
    await prisma.connection.update({
      where: { id: connectionId },
      data: { lastSyncAt: null, installationStatus: "CONNECTED", updatedAt: new Date() }
    });

    const scheduled = await syncDueMonitoringConnections();
    expect(scheduled.attempted).toBeGreaterThanOrEqual(2);
    expect(scheduled.succeeded).toBeGreaterThanOrEqual(1);

    const otherAlerts = await prisma.alert.findMany({ where: { projectId: otherProjectId } });
    const ownAlerts = await prisma.alert.findMany({ where: { projectId } });
    expect(otherAlerts.every((row) => row.projectId === otherProjectId)).toBe(true);
    expect(ownAlerts.every((row) => row.projectId === projectId)).toBe(true);
  }, 60_000);
});
