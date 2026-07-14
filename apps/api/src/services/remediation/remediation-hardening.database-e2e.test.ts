import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { runIncidentAutoHeal } from "./auto-heal.service";
import { executeReviewHttpExpectedStatus } from "./executors/review-http-expected-status.executor";
import { ensureE2EOrgPlan } from "../test-helpers/e2e-org-plan";

const enabled = process.env.RUN_DATABASE_E2E === "true";

describe.runIf(enabled)("remediation production hardening", () => {
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const serviceId = randomUUID();
  const checkId = randomUUID();
  const incidentId = randomUUID();
  const alertId = randomUUID();

  beforeAll(async () => {
    process.env.AUTO_REMEDIATION_ENABLED = "true";
    process.env.AUTO_HEAL_DEFAULT_ENABLED = "true";

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Remediation Hardening E2E",
        slug: `remediation-hardening-${organizationId}`,
        updatedAt: new Date()
      }
    });
    await ensureE2EOrgPlan(organizationId, "BUSINESS");
    await prisma.project.create({
      data: {
        id: projectId,
        name: "Hardening Project",
        slug: `hardening-${projectId}`,
        clientName: "E2E",
        environment: "test",
        apiKey: randomUUID(),
        signingSecret: randomUUID(),
        organizationId,
        updatedAt: new Date()
      }
    });
    await prisma.service.create({
      data: {
        id: serviceId,
        projectId,
        name: "HTTP Review Service",
        type: "COMPONENT",
        baseUrl: "http://127.0.0.1:9/not-found",
        updatedAt: new Date()
      }
    });
    await prisma.check.create({
      data: {
        id: checkId,
        serviceId,
        name: "HTTP status review check",
        type: "HTTP",
        intervalSeconds: 300,
        timeoutMs: 1000,
        expectedStatusCode: 503,
        isActive: true,
        updatedAt: new Date()
      }
    });
    await prisma.checkResult.create({
      data: {
        id: randomUUID(),
        checkId,
        status: "FAIL",
        responseCode: 200,
        responseTimeMs: 12,
        message: "[HTTP_STATUS_MISMATCH] Expected 503, received 200.",
        rawJson: {
          failureClass: "HTTP_STATUS_MISMATCH",
          expectedStatusCode: 503,
          actualStatusCode: 200
        }
      }
    });
    await prisma.alert.create({
      data: {
        id: alertId,
        projectId,
        serviceId,
        sourceType: "CHECK",
        sourceId: checkId,
        severity: "HIGH",
        category: "AVAILABILITY",
        title: "HTTP status mismatch",
        message: "[HTTP_STATUS_MISMATCH] Expected 503, received 200."
      }
    });
    await prisma.incident.create({
      data: {
        id: incidentId,
        projectId,
        title: "HTTP status mismatch incident",
        severity: "HIGH",
        IncidentAlert: { create: [{ alertId }] }
      }
    });
    await prisma.autoRemediationPolicy.upsert({
      where: {
        organizationId_policyType_policyKey: {
          organizationId,
          policyType: "GLOBAL",
          policyKey: ""
        }
      },
      update: { enabled: true, updatedBy: "e2e" },
      create: {
        id: randomUUID(),
        organizationId,
        policyType: "GLOBAL",
        policyKey: "",
        enabled: true,
        updatedBy: "e2e",
        updatedAt: new Date()
      }
    });
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it("suppresses concurrent auto-heal runs for the same incident", async () => {
    const [first, second] = await Promise.all([
      runIncidentAutoHeal(organizationId, incidentId),
      runIncidentAutoHeal(organizationId, incidentId)
    ]);

    const attempted = [first, second].filter((row) => row.attempted);
    const suppressed = [first, second].filter((row) => !row.attempted);

    expect(
      attempted.length,
      `first=${JSON.stringify(first)} second=${JSON.stringify(second)}`
    ).toBe(1);
    expect(suppressed.length).toBe(1);
    expect(suppressed[0]?.blockedReason?.toLowerCase()).toContain("already running");

    const acknowledgeLogs = await prisma.remediationLog.count({
      where: {
        organizationId,
        incidentId,
        action: "ACKNOWLEDGE_INCIDENT",
        executionMode: "AUTOMATIC"
      }
    });
    expect(acknowledgeLogs).toBeLessThanOrEqual(1);
  });

  it("rolls back failed HTTP status verification with audit and timeline steps", async () => {
    const result = await executeReviewHttpExpectedStatus({
      context: {
        organizationId,
        projectId,
        incidentId,
        serviceId,
        checkId,
        extra: {
          newExpectedStatusCode: 200,
          approvalReason: "Endpoint is intentionally healthy in this environment",
          actualStatusCode: 200
        }
      },
      executedBy: undefined
    });

    expect(result.success).toBe(false);
    expect(result.summary).toContain("rolled back");

    const check = await prisma.check.findUnique({
      where: { id: checkId },
      select: { expectedStatusCode: true }
    });
    expect(check?.expectedStatusCode).toBe(503);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: checkId, action: "HTTP_EXPECTED_STATUS_ROLLBACK" },
      orderBy: { createdAt: "desc" }
    });
    expect(audit?.metadataJson).toMatchObject({
      previousExpectedStatus: 503,
      attemptedExpectedStatus: 200,
      restoredExpectedStatus: 503
    });

    const timeline = await prisma.incidentTimelineEvent.findMany({
      where: { incidentId, sourceId: checkId },
      orderBy: { occurredAt: "asc" }
    });
    const steps = timeline.map((row) => (row.payloadJson as { step?: string } | null)?.step);
    expect(steps).toEqual(
      expect.arrayContaining(["APPROVED", "CONFIG_UPDATED", "VERIFICATION", "ROLLBACK"])
    );

    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: { status: true }
    });
    expect(incident?.status).not.toBe("RESOLVED");
  });
});
