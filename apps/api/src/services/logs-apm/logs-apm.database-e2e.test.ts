import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { persistLogRecord } from "./log-persist.service";
import { queryLogRecords } from "./log-query.service";
import { persistSpanRecord } from "./span-persist.service";
import { reconstructTrace } from "./trace-reconstruct.service";
import { contributeSpanToApmWindows } from "./apm-aggregate.service";
import { assertNoSecrets } from "./log-redaction";
import type { NormalizedSignalDraft } from "../otel/otel-normalize";

const run = process.env.RUN_DATABASE_E2E === "true";

const describeDb = run ? describe : describe.skip;

describeDb("Phase 6 Logs/APM database E2E", () => {
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const connectionId = randomUUID();
  const otherOrgId = randomUUID();
  const otherProjectId = randomUUID();
  let entityId: string;

  beforeAll(async () => {
    process.env.OPSWATCH_LOGS_INGESTION_ENABLED = "true";
    process.env.OPSWATCH_LOGS_EXPLORER_ENABLED = "true";
    process.env.OPSWATCH_TRACE_APM_PROCESSING_ENABLED = "true";
    process.env.OPSWATCH_APM_UI_ENABLED = "true";
    process.env.OPSWATCH_OTEL_ALERT_GENERATION_ENABLED = "false";

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Phase6 Logs Org",
        slug: `phase6-logs-${organizationId.slice(0, 8)}`,
        updatedAt: new Date()
      }
    });
    await prisma.organization.create({
      data: {
        id: otherOrgId,
        name: "Phase6 Other Org",
        slug: `phase6-other-${otherOrgId.slice(0, 8)}`,
        updatedAt: new Date()
      }
    });
    await prisma.project.create({
      data: {
        id: projectId,
        name: "Phase6 App",
        slug: `phase6-app-${projectId.slice(0, 8)}`,
        clientName: "test",
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
        name: "Other App",
        slug: `phase6-other-app-${otherProjectId.slice(0, 8)}`,
        clientName: "test",
        environment: "test",
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
        name: "phase6-otel",
        type: "OTEL_COLLECTOR",
        mode: "PUSH",
        environment: "test",
        updatedAt: new Date()
      }
    });
    entityId = randomUUID();
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
  });

  afterAll(async () => {
    await prisma.logEvidenceLink.deleteMany({ where: { organizationId } });
    await prisma.spanEvidenceLink.deleteMany({ where: { organizationId } });
    await prisma.apmEvidenceLink.deleteMany({ where: { organizationId } });
    await prisma.logRecord.deleteMany({ where: { organizationId } });
    await prisma.logOccurrenceGroup.deleteMany({ where: { organizationId } });
    await prisma.spanRecord.deleteMany({ where: { organizationId } });
    await prisma.traceRecord.deleteMany({ where: { organizationId } });
    await prisma.apmServiceWindow.deleteMany({ where: { organizationId } });
    await prisma.apmEndpointWindow.deleteMany({ where: { organizationId } });
    await prisma.apmDependencyWindow.deleteMany({ where: { organizationId } });
    await prisma.connection.deleteMany({ where: { id: connectionId } });
    await prisma.operationalEntity.deleteMany({ where: { id: entityId } });
    await prisma.project.deleteMany({ where: { id: { in: [projectId, otherProjectId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [organizationId, otherOrgId] } } });
  });

  const logDraft = (body: string, overrides: Partial<NormalizedSignalDraft> = {}): NormalizedSignalDraft => ({
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
    attributes: {},
    resourceAttributes: { "service.name": "phase6-test-checkout" },
    healthImpact: "CRITICAL",
    freshUntil: new Date(Date.now() + 15 * 60_000),
    ...overrides
  });

  it("persists redacted logs, groups repeats, and searches with org isolation", async () => {
    const secretBody =
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret password=super-secret Unhandled NullPointerException";
    for (let i = 0; i < 3; i += 1) {
      await persistLogRecord({
        organizationId,
        projectId,
        connectionId,
        entityId,
        signalId: randomUUID(),
        draft: logDraft(`${secretBody} #${i}`, {
          attributes: { api_key: "sk_live_should_redact", "exception.type": "NullPointerException" }
        })
      });
    }

    const rows = await prisma.logRecord.findMany({ where: { organizationId, projectId } });
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      assertNoSecrets(row);
      expect(row.body ?? "").not.toContain("super-secret");
      expect(JSON.stringify(row.attributesJson)).not.toContain("sk_live_should_redact");
      expect(row.redactionStatus).toBe("REDACTED");
    }

    const groups = await prisma.logOccurrenceGroup.findMany({
      where: { organizationId, projectId }
    });
    expect(groups.some((g) => g.occurrenceCount >= 2)).toBe(true);

    const search = await queryLogRecords({
      organizationId,
      projectId,
      text: "NullPointer",
      limit: 20
    });
    expect(search.state).toBe("OK");
    expect(search.items.length).toBeGreaterThan(0);

    const crossOrg = await queryLogRecords({
      organizationId: otherOrgId,
      projectId,
      limit: 20
    });
    expect(crossOrg.items.length).toBe(0);
  });

  it("persists spans, reconstructs partial traces, and aggregates APM", async () => {
    const traceId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const draft: NormalizedSignalDraft = {
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
        "exception.message": "boom"
      },
      resourceAttributes: { "service.name": "phase6-test-checkout" },
      healthImpact: "CRITICAL",
      normalizedStatus: "ERROR",
      freshUntil: new Date(Date.now() + 15 * 60_000)
    };

    const batch = await prisma.otelIngestBatch.create({
      data: {
        id: randomUUID(),
        organizationId,
        projectId,
        connectionId,
        environment: "test",
        protocol: "NORMALIZED_JSON",
        idempotencyHash: randomUUID(),
        status: "PROCESSED",
        expiresAt: new Date(Date.now() + 86400000),
        updatedAt: new Date()
      }
    });

    await persistSpanRecord({
      organizationId,
      projectId,
      connectionId,
      serviceEntityId: entityId,
      batchId: batch.id,
      signalId: randomUUID(),
      draft
    });

    const reconstructed = await reconstructTrace({
      organizationId,
      projectId,
      traceId
    });
    expect(reconstructed).not.toBeNull();
    expect(reconstructed!.isPartial).toBe(true);
    expect(reconstructed!.missingParents.length).toBeGreaterThan(0);

    for (let i = 0; i < 5; i += 1) {
      await contributeSpanToApmWindows({
        organizationId,
        projectId,
        environment: "test",
        serviceName: "phase6-test-checkout",
        entityId,
        operation: "/checkout",
        httpMethod: "POST",
        durationMs: 200 + i * 10,
        isError: i % 2 === 0,
        isSlow: false,
        isTimeout: false,
        observedAt: new Date()
      });
    }

    const window = await prisma.apmServiceWindow.findFirst({
      where: { organizationId, projectId, serviceName: "phase6-test-checkout", windowSize: "5m" },
      orderBy: { windowStart: "desc" }
    });
    expect(window).not.toBeNull();
    expect(window!.sampleCount).toBeGreaterThanOrEqual(5);
    expect(window!.requestCount).toBeGreaterThanOrEqual(5);
  });
});
