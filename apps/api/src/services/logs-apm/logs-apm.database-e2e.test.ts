/**
 * TEST-ONLY Phase 6 Logs/APM database E2E.
 * Requires RUN_DATABASE_E2E=true and applied Phase 6 migration.
 */
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { persistLogRecord } from "./log-persist.service";
import { queryLogRecords } from "./log-query.service";
import { persistSpanRecord } from "./span-persist.service";
import { reconstructTrace } from "./trace-reconstruct.service";
import { contributeSpanToApmWindows } from "./apm-aggregate.service";
import { maybeAlertFromLogGroup, maybeAlertFromApmWindow } from "./logs-apm-alert.service";
import { assertNoSecrets } from "./log-redaction";
import { evaluateApmHealth } from "./apm-health.service";
import type { NormalizedSignalDraft } from "../otel/otel-normalize";

const run = process.env.RUN_DATABASE_E2E === "true";
const describeDb = run ? describe : describe.skip;

describeDb("Phase 6 Logs/APM database E2E", () => {
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const connectionId = randomUUID();
  const otherOrgId = randomUUID();
  const otherProjectId = randomUUID();
  let entityId = "";
  let targetEntityId = "";
  let relationshipId = "";
  let batchId = "";

  beforeAll(async () => {
    process.env.OPSWATCH_LOGS_INGESTION_ENABLED = "true";
    process.env.OPSWATCH_LOGS_EXPLORER_ENABLED = "true";
    process.env.OPSWATCH_TRACE_APM_PROCESSING_ENABLED = "true";
    process.env.OPSWATCH_APM_UI_ENABLED = "true";
    process.env.OPSWATCH_OTEL_ALERT_GENERATION_ENABLED = "true";

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "TEST ONLY — Phase6 Logs Org",
        slug: `test-phase6-${organizationId.slice(0, 8)}`,
        updatedAt: new Date()
      }
    });
    await prisma.organization.create({
      data: {
        id: otherOrgId,
        name: "TEST ONLY — Phase6 Other Org",
        slug: `test-phase6-other-${otherOrgId.slice(0, 8)}`,
        updatedAt: new Date()
      }
    });
    await prisma.project.create({
      data: {
        id: projectId,
        name: "TEST ONLY — Phase6 App",
        slug: `test-phase6-app-${projectId.slice(0, 8)}`,
        clientName: "TEST ONLY",
        environment: "test",
        organizationId,
        apiKey: `pk_${projectId}`,
        signingSecret: `ss_${projectId}`,
        updatedAt: new Date()
      }
    });
    await prisma.project.create({
      data: {
        id: otherProjectId,
        name: "TEST ONLY — Other App",
        slug: `test-phase6-other-app-${otherProjectId.slice(0, 8)}`,
        clientName: "TEST ONLY",
        environment: "production",
        organizationId: otherOrgId,
        apiKey: `pk_${otherProjectId}`,
        signingSecret: `ss_${otherProjectId}`,
        updatedAt: new Date()
      }
    });
    await prisma.connection.create({
      data: {
        id: connectionId,
        organizationId,
        projectId,
        name: "TEST ONLY phase6-otel",
        type: "OTEL_COLLECTOR",
        mode: "PUSH",
        environment: "test",
        updatedAt: new Date()
      }
    });
    entityId = randomUUID();
    targetEntityId = randomUUID();
    relationshipId = randomUUID();
    await prisma.operationalEntity.create({
      data: {
        id: entityId,
        organizationId,
        projectId,
        entityType: "SERVICE",
        name: "phase6-test-checkout",
        environment: "test",
        updatedAt: new Date()
      }
    });
    await prisma.operationalEntity.create({
      data: {
        id: targetEntityId,
        organizationId,
        projectId,
        entityType: "DATABASE",
        name: "phase6-test-postgres",
        environment: "test",
        updatedAt: new Date()
      }
    });
    await prisma.operationalRelationship.create({
      data: {
        id: relationshipId,
        organizationId,
        projectId,
        sourceEntityId: entityId,
        targetEntityId,
        relationshipType: "DEPENDS_ON",
        health: "UNKNOWN",
        updatedAt: new Date()
      }
    });
    batchId = randomUUID();
    await prisma.otelIngestBatch.create({
      data: {
        id: batchId,
        organizationId,
        projectId,
        connectionId,
        environment: "test",
        protocol: "NORMALIZED_JSON",
        idempotencyHash: randomUUID(),
        status: "PROCESSED",
        expiresAt: new Date(Date.now() + 86_400_000),
        updatedAt: new Date()
      }
    });
  });

  afterAll(async () => {
    await prisma.logEvidenceLink.deleteMany({ where: { organizationId } });
    await prisma.spanEvidenceLink.deleteMany({ where: { organizationId } });
    await prisma.apmEvidenceLink.deleteMany({ where: { organizationId } });
    await prisma.incidentAlert.deleteMany({
      where: { Incident: { projectId } }
    });
    await prisma.otelIncidentEvidence.deleteMany({ where: { organizationId } });
    await prisma.otelAlertEvidence.deleteMany({ where: { organizationId } });
    await prisma.incident.deleteMany({ where: { projectId } });
    await prisma.alert.deleteMany({ where: { projectId } });
    await prisma.logRecord.deleteMany({ where: { organizationId } });
    await prisma.logOccurrenceGroup.deleteMany({ where: { organizationId } });
    await prisma.spanRecord.deleteMany({ where: { organizationId } });
    await prisma.traceRecord.deleteMany({ where: { organizationId } });
    await prisma.apmServiceWindow.deleteMany({ where: { organizationId } });
    await prisma.apmEndpointWindow.deleteMany({ where: { organizationId } });
    await prisma.apmDependencyWindow.deleteMany({ where: { organizationId } });
    await prisma.otelIngestBatch.deleteMany({ where: { id: batchId } });
    await prisma.operationalRelationship.deleteMany({ where: { id: relationshipId } });
    await prisma.operationalEntity.deleteMany({
      where: { id: { in: [entityId, targetEntityId] } }
    });
    await prisma.connection.deleteMany({ where: { id: connectionId } });
    await prisma.project.deleteMany({ where: { id: { in: [projectId, otherProjectId] } } });
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationId, otherOrgId] } }
    });
  });

  const logDraft = (
    body: string,
    overrides: Partial<NormalizedSignalDraft> = {}
  ): NormalizedSignalDraft => ({
    signalType: "LOG",
    kind: "LOG",
    name: "exception",
    serviceName: "phase6-test-checkout",
    environment: "test",
    resourceIdentity: "phase6-test-checkout:test",
    observedAt: new Date(),
    severity: "CRITICAL",
    body,
    fingerprint: randomUUID().replace(/-/g, "").slice(0, 40),
    attributes: { "exception.type": "NullPointerException" },
    resourceAttributes: { "service.name": "phase6-test-checkout" },
    healthImpact: "CRITICAL",
    freshUntil: new Date(Date.now() + 15 * 60_000),
    ...overrides
  });

  it("redacts secrets, groups repeats, and avoids alert storms", async () => {
    const secretBody =
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret password=super-secret Unhandled NullPointerException";
    const alertIds: Array<string | null> = [];
    for (let i = 0; i < 4; i += 1) {
      const persisted = await persistLogRecord({
        organizationId,
        projectId,
        connectionId,
        entityId,
        batchId,
        signalId: randomUUID(),
        draft: logDraft(`${secretBody} #${i}`)
      });
      expect(persisted.logId).toBeTruthy();
      const group = await prisma.logOccurrenceGroup.findUniqueOrThrow({
        where: { id: persisted.groupId! }
      });
      const alertId = await maybeAlertFromLogGroup({
        organizationId,
        projectId,
        groupId: group.id,
        entityId,
        logId: persisted.logId,
        severity: "CRITICAL",
        fingerprint: group.fingerprint,
        occurrenceCount: group.occurrenceCount,
        message: secretBody,
        observedAt: new Date(),
        traceId: null
      });
      alertIds.push(alertId);
    }

    const rows = await prisma.logRecord.findMany({ where: { organizationId, projectId } });
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) {
      assertNoSecrets(row);
      expect(row.body ?? "").not.toContain("super-secret");
      expect(JSON.stringify(row.attributesJson)).not.toContain("sk_live");
    }

    const groups = await prisma.logOccurrenceGroup.findMany({
      where: { organizationId, projectId }
    });
    expect(groups.some((g) => g.occurrenceCount >= 3)).toBe(true);

    const openAlerts = await prisma.alert.findMany({
      where: { projectId, sourceType: "OTEL_POLICY", title: "Repeated fatal log group" }
    });
    expect(openAlerts.length).toBe(1);
    expect(alertIds.filter(Boolean).length).toBeGreaterThanOrEqual(1);

    const links = await prisma.logEvidenceLink.findMany({
      where: { organizationId, alertId: openAlerts[0]!.id }
    });
    expect(links.length).toBeGreaterThanOrEqual(1);
  });

  it("reconstructs partial traces, late spans, and duplicate idempotency", async () => {
    const traceId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const childDraft: NormalizedSignalDraft = {
      signalType: "SPAN",
      kind: "SPAN",
      name: "POST /checkout",
      serviceName: "phase6-test-checkout",
      environment: "test",
      resourceIdentity: "phase6-test-checkout:test",
      observedAt: new Date(),
      severity: "HIGH",
      value: 250,
      traceId,
      spanId: "bbbbbbbbbbbbbbbb",
      parentSpanId: "cccccccccccccccc",
      fingerprint: randomUUID().replace(/-/g, "").slice(0, 40),
      attributes: {
        "http.method": "POST",
        "http.route": "/checkout",
        "http.status_code": 500,
        duration_ms: 250,
        "exception.message": "boom",
        "db.system": "postgresql"
      },
      resourceAttributes: { "service.name": "phase6-test-checkout" },
      healthImpact: "CRITICAL",
      normalizedStatus: "ERROR",
      freshUntil: new Date(Date.now() + 15 * 60_000)
    };

    const first = await persistSpanRecord({
      organizationId,
      projectId,
      connectionId,
      serviceEntityId: entityId,
      destinationEntityId: targetEntityId,
      batchId,
      signalId: randomUUID(),
      draft: childDraft
    });
    expect(first.spanId).toBeTruthy();

    const duplicate = await persistSpanRecord({
      organizationId,
      projectId,
      connectionId,
      serviceEntityId: entityId,
      batchId,
      signalId: randomUUID(),
      draft: childDraft
    });
    expect(duplicate.spanId).toBe(first.spanId);

    const spanCount = await prisma.spanRecord.count({
      where: { organizationId, traceId }
    });
    expect(spanCount).toBe(1);

    let reconstructed = await reconstructTrace({
      organizationId,
      projectId,
      traceId
    });
    expect(reconstructed?.isPartial).toBe(true);
    expect(reconstructed?.missingParents.length).toBeGreaterThan(0);

    // Late-arriving parent span
    await persistSpanRecord({
      organizationId,
      projectId,
      connectionId,
      serviceEntityId: entityId,
      batchId,
      signalId: randomUUID(),
      draft: {
        ...childDraft,
        spanId: "cccccccccccccccc",
        parentSpanId: null,
        name: "root",
        attributes: { duration_ms: 300, "http.route": "/checkout" },
        healthImpact: "DEGRADED",
        normalizedStatus: "OK",
        fingerprint: randomUUID().replace(/-/g, "").slice(0, 40)
      }
    });

    reconstructed = await reconstructTrace({
      organizationId,
      projectId,
      traceId,
      lateArrival: true
    });
    expect(reconstructed).not.toBeNull();
    expect(reconstructed!.spans.length).toBe(2);
    const traceRow = await prisma.traceRecord.findFirst({
      where: { organizationId, projectId, traceId }
    });
    expect(traceRow?.lateArrivalCount).toBeGreaterThanOrEqual(1);
  });

  it("builds APM windows, updates topology health, and links alerts", async () => {
    for (let i = 0; i < 6; i += 1) {
      await contributeSpanToApmWindows({
        organizationId,
        projectId,
        environment: "test",
        serviceName: "phase6-test-checkout",
        entityId,
        operation: "/checkout",
        httpMethod: "POST",
        durationMs: 200 + i * 20,
        isError: i < 3,
        isSlow: i > 4,
        isTimeout: i === 5,
        observedAt: new Date(),
        destinationEntityId: targetEntityId,
        targetServiceName: "phase6-test-postgres",
        relationshipId,
        isDependency: true
      });
    }

    const serviceWindow = await prisma.apmServiceWindow.findFirst({
      where: {
        organizationId,
        projectId,
        serviceName: "phase6-test-checkout",
        windowSize: "5m"
      },
      orderBy: { windowStart: "desc" }
    });
    expect(serviceWindow).not.toBeNull();
    expect(serviceWindow!.sampleCount).toBeGreaterThanOrEqual(5);
    expect(serviceWindow!.requestCount).toBeGreaterThanOrEqual(5);

    const depWindow = await prisma.apmDependencyWindow.findFirst({
      where: {
        organizationId,
        projectId,
        sourceServiceName: "phase6-test-checkout",
        targetServiceName: "phase6-test-postgres",
        windowSize: "5m"
      },
      orderBy: { windowStart: "desc" }
    });
    expect(depWindow).not.toBeNull();

    const relationship = await prisma.operationalRelationship.findUniqueOrThrow({
      where: { id: relationshipId }
    });
    expect(["DEGRADED", "CRITICAL", "HEALTHY", "UNKNOWN"]).toContain(relationship.health);
    expect(relationship.errorRate).not.toBeNull();

    const alertId = await maybeAlertFromApmWindow({
      organizationId,
      projectId,
      entityId,
      relationshipId,
      serviceName: "phase6-test-checkout",
      environment: "test",
      health: serviceWindow!.health === "UNKNOWN" ? "CRITICAL" : serviceWindow!.health,
      healthRule: serviceWindow!.healthRule ?? "error_rate_critical",
      errorRate: Math.max(serviceWindow!.errorRate, 0.5),
      latencyP95Ms: serviceWindow!.latencyP95Ms,
      sampleCount: serviceWindow!.sampleCount,
      windowId: serviceWindow!.id,
      windowKind: "service",
      observedAt: new Date(),
      message: "TEST ONLY APM threshold exceeded"
    });
    expect(alertId).toBeTruthy();

    const apmLinks = await prisma.apmEvidenceLink.findMany({
      where: { alertId: alertId! }
    });
    expect(apmLinks.length).toBeGreaterThanOrEqual(1);

    // Incident evidence link (summary preserved for retention tests)
    const incidentId = randomUUID();
    await prisma.incident.create({
      data: {
        id: incidentId,
        projectId,
        title: "TEST ONLY Phase6 APM incident",
        severity: "HIGH",
        status: "OPEN"
      }
    });
    await prisma.incidentAlert.create({
      data: {
        incidentId,
        alertId: alertId!
      }
    });
    await prisma.apmEvidenceLink.create({
      data: {
        id: randomUUID(),
        organizationId,
        projectId,
        incidentId,
        alertId: alertId!,
        serviceWindowId: serviceWindow!.id,
        dependencyWindowId: depWindow?.id ?? null,
        evidenceKind: "apm_incident_link",
        summary: "TEST ONLY linked APM window",
        confidence: 0.8,
        observedAt: new Date()
      }
    });
    await prisma.spanEvidenceLink.create({
      data: {
        id: randomUUID(),
        organizationId,
        projectId,
        incidentId,
        alertId: alertId!,
        traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        evidenceKind: "failing_trace",
        summary: "TEST ONLY failing checkout trace",
        confidence: 0.7,
        observedAt: new Date()
      }
    });
  });

  it("enforces org/environment isolation and healthy/stale health states", async () => {
    const search = await queryLogRecords({
      organizationId,
      projectId,
      environment: "test",
      limit: 20
    });
    expect(search.state).toBe("OK");
    expect(search.items.length).toBeGreaterThan(0);

    const wrongEnv = await queryLogRecords({
      organizationId,
      projectId,
      environment: "production",
      limit: 20
    });
    expect(wrongEnv.items.length).toBe(0);

    const crossOrg = await queryLogRecords({
      organizationId: otherOrgId,
      projectId,
      limit: 20
    });
    expect(crossOrg.items.length).toBe(0);

    const healthy = evaluateApmHealth({
      errorRate: 0,
      latencyP95Ms: 40,
      sampleCount: 20,
      baselineLatencyP95Ms: 50,
      freshUntil: new Date(Date.now() + 60_000),
      now: new Date()
    });
    expect(healthy.health).toBe("HEALTHY");

    const stale = evaluateApmHealth({
      errorRate: 0.1,
      latencyP95Ms: 100,
      sampleCount: 20,
      freshUntil: new Date(Date.now() - 60_000),
      now: new Date()
    });
    expect(stale.health).toBe("UNKNOWN");
  });

  it("prunes expired logs/spans/windows while preserving incident evidence", async () => {
    const orphanLogId = randomUUID();
    const orphanSpanId = randomUUID();
    const orphanWindowId = randomUUID();
    const now = new Date();
    const old = new Date(Date.now() - 40 * 24 * 60 * 60_000);

    await prisma.logRecord.create({
      data: {
        id: orphanLogId,
        organizationId,
        projectId,
        environment: "test",
        fingerprint: `orphan-${orphanLogId.slice(0, 8)}`,
        timestamp: old,
        retentionExpiresAt: new Date(Date.now() - 60_000),
        body: "TEST ONLY expired orphan log",
        redactionStatus: "CLEAN"
      }
    });
    await prisma.spanRecord.create({
      data: {
        id: orphanSpanId,
        organizationId,
        projectId,
        environment: "test",
        traceId: "dddddddddddddddddddddddddddddddd",
        spanId: "eeeeeeeeeeeeeeee",
        operationName: "orphan",
        startTimestamp: old,
        retentionExpiresAt: new Date(Date.now() - 60_000),
        updatedAt: now
      }
    });
    await prisma.apmServiceWindow.create({
      data: {
        id: orphanWindowId,
        organizationId,
        projectId,
        serviceName: "phase6-orphan",
        environment: "test",
        windowSize: "1m",
        windowStart: new Date(old.getTime() - 60_000),
        windowEnd: old,
        updatedAt: now
      }
    });

    // Bounded prune mirroring worker pruneLogsApmForOrg (unlinked expired only).
    await prisma.logRecord.deleteMany({
      where: {
        organizationId,
        OR: [{ retentionExpiresAt: { lt: now } }, { timestamp: { lt: old } }],
        EvidenceLinks: { none: {} },
        id: orphanLogId
      }
    });
    await prisma.spanRecord.deleteMany({
      where: {
        organizationId,
        OR: [{ retentionExpiresAt: { lt: now } }, { startTimestamp: { lt: old } }],
        EvidenceLinks: { none: {} },
        id: orphanSpanId
      }
    });
    await prisma.apmServiceWindow.deleteMany({
      where: {
        organizationId,
        windowEnd: { lte: old },
        EvidenceLinks: { none: {} },
        id: orphanWindowId
      }
    });

    expect(await prisma.logRecord.findUnique({ where: { id: orphanLogId } })).toBeNull();
    expect(await prisma.spanRecord.findUnique({ where: { id: orphanSpanId } })).toBeNull();
    expect(await prisma.apmServiceWindow.findUnique({ where: { id: orphanWindowId } })).toBeNull();

    const incidentLinks = await prisma.apmEvidenceLink.count({
      where: { organizationId, incidentId: { not: null } }
    });
    expect(incidentLinks).toBeGreaterThanOrEqual(1);
  });
});
