import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../lib/prisma";
import { seedAutomationPlaybooks } from "./automation-playbooks.seed";
import { planAutomationForIncident } from "./automation-planner.service";
import {
  approveAutomationRun,
  rejectAutomationRun
} from "./automation-run-executor.service";
import { ensureE2EOrgPlan } from "../test-helpers/e2e-org-plan";

const enabled = process.env.RUN_DATABASE_E2E === "true";
const TAG = "automation-http-approval-e2e";

describe.runIf(enabled)("automation HTTP mismatch approval execution", () => {
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const serviceId = randomUUID();
  const checkId = randomUUID();
  const incidentId = randomUUID();
  const alertId = randomUUID();
  const operatorUserId = randomUUID();

  beforeAll(async () => {
    process.env.AUTO_REMEDIATION_ENABLED = "true";

    await seedAutomationPlaybooks(prisma);

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Automation HTTP Approval E2E",
        slug: `automation-http-${organizationId}`,
        updatedAt: new Date()
      }
    });
    await ensureE2EOrgPlan(organizationId, "GROWTH");
    await prisma.user.create({
      data: {
        id: operatorUserId,
        name: "Automation Operator",
        email: `operator-${operatorUserId}@e2e.test`,
        passwordHash: "hash",
        role: "AUTOMATION_OPERATOR",
        organizationId,
        isActive: true,
        updatedAt: new Date()
      }
    });
    await prisma.project.create({
      data: {
        id: projectId,
        name: "HTTP Approval Project",
        slug: `http-approval-${projectId}`,
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
        baseUrl: "http://127.0.0.1:9/mismatch",
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
        message: `${TAG} [HTTP_STATUS_MISMATCH] Expected 503, received 200.`,
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
        title: `${TAG} HTTP status mismatch`,
        message: `${TAG} [HTTP_STATUS_MISMATCH] Expected 503, received 200.`
      }
    });
    await prisma.incident.create({
      data: {
        id: incidentId,
        projectId,
        title: `${TAG} HTTP status mismatch incident`,
        severity: "HIGH",
        IncidentAlert: { create: [{ alertId }] }
      }
    });
    await prisma.automationPolicy.upsert({
      where: {
        organizationId_policyKey: {
          organizationId,
          policyKey: "GLOBAL"
        }
      },
      update: { enabled: true, executionMode: "APPROVAL", updatedAt: new Date() },
      create: {
        id: randomUUID(),
        organizationId,
        policyKey: "GLOBAL",
        enabled: true,
        executionMode: "APPROVAL",
        updatedBy: TAG,
        updatedAt: new Date()
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
      update: { enabled: true, updatedBy: TAG },
      create: {
        id: randomUUID(),
        organizationId,
        policyType: "GLOBAL",
        policyKey: "",
        enabled: true,
        updatedBy: TAG,
        updatedAt: new Date()
      }
    });
  });

  afterAll(async () => {
    await prisma.automationRunStep.deleteMany({
      where: { Run: { incidentId } }
    });
    await prisma.automationOutcome.deleteMany({
      where: { Run: { incidentId } }
    });
    await prisma.automationApproval.deleteMany({
      where: { Run: { incidentId } }
    });
    await prisma.automationRun.deleteMany({ where: { incidentId } });
    await prisma.remediationLog.deleteMany({ where: { incidentId } });
    await prisma.incidentTimelineEvent.deleteMany({ where: { incidentId } });
    await prisma.auditLog.deleteMany({
      where: { entityType: "AUTOMATION_RUN" }
    });
    await prisma.incidentAlert.deleteMany({ where: { incidentId } });
    await prisma.incident.deleteMany({ where: { id: incidentId } });
    await prisma.alert.deleteMany({ where: { id: alertId } });
    await prisma.checkResult.deleteMany({ where: { checkId } });
    await prisma.check.deleteMany({ where: { id: checkId } });
    await prisma.service.deleteMany({ where: { id: serviceId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: operatorUserId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it("selects HTTP investigation playbook with approval-required review step before execution", async () => {
    const plan = await planAutomationForIncident({
      organizationId,
      incidentId,
      createdBy: "e2e"
    });

    expect(plan?.playbookKey).toBe("HTTP_CHECK_INVESTIGATION");
    expect(plan?.executionMode).toBe("APPROVAL");
    expect(plan?.steps.map((step) => step.action)).toEqual([
      "RERUN_CHECK",
      "ADD_INCIDENT_NOTE",
      "REVIEW_HTTP_EXPECTED_STATUS"
    ]);

    const reviewStep = plan?.steps.find((step) => step.action === "REVIEW_HTTP_EXPECTED_STATUS");
    expect(reviewStep?.approvalRequired).toBe(true);

    const run = await prisma.automationRun.findUnique({
      where: { id: plan!.runId! },
      include: { Steps: true }
    });
    expect(run?.status).toBe("APPROVAL_PENDING");

    const reviewLogs = await prisma.remediationLog.count({
      where: { incidentId, action: "REVIEW_HTTP_EXPECTED_STATUS" }
    });
    expect(reviewLogs).toBe(0);

    const check = await prisma.check.findUnique({
      where: { id: checkId },
      select: { expectedStatusCode: true }
    });
    expect(check?.expectedStatusCode).toBe(503);
  });

  it("rejects plan without remediation logs or configuration changes", async () => {
    const plan = await planAutomationForIncident({
      organizationId,
      incidentId,
      createdBy: "e2e-reject"
    });
    expect(plan?.runId).toBeTruthy();

    await rejectAutomationRun({
      organizationId,
      runId: plan!.runId!,
      rejectedBy: operatorUserId,
      reason: "Mismatch needs manual investigation first."
    });

    const run = await prisma.automationRun.findUnique({ where: { id: plan!.runId! } });
    expect(run?.status).toBe("REJECTED");

    const remediationCount = await prisma.remediationLog.count({ where: { incidentId } });
    expect(remediationCount).toBe(0);

    const check = await prisma.check.findUnique({
      where: { id: checkId },
      select: { expectedStatusCode: true }
    });
    expect(check?.expectedStatusCode).toBe(503);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "AUTOMATION_RUN_REJECTED", entityId: plan!.runId! }
    });
    expect(audit).toBeTruthy();

    const timeline = await prisma.incidentTimelineEvent.findFirst({
      where: { incidentId, sourceId: plan!.runId!, eventType: "AUTOMATION" }
    });
    expect(timeline?.summary).toContain("rejected");
  });

  it("executes approved plan through remediation pipeline with rollback on failed verification", async () => {
    let fetchCalls = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return { status: 200, text: async () => "ok" } as Response;
      }
      return { status: 503, text: async () => "service unavailable" } as Response;
    });

    try {
      const plan = await planAutomationForIncident({
        organizationId,
        incidentId,
        createdBy: "e2e-approve"
      });
      expect(plan?.runId).toBeTruthy();

      const result = await approveAutomationRun({
        organizationId,
        runId: plan!.runId!,
        approvedBy: operatorUserId,
        reason: "Reviewed dependency impact and approved low-risk recovery steps."
      });

      expect(["ROLLED_BACK", "FAILED", "COMPLETED"]).toContain(result.status);

      const run = await prisma.automationRun.findUnique({
        where: { id: plan!.runId! },
        include: { Steps: { orderBy: { stepOrder: "asc" } } }
      });
      expect(run?.approvedBy).toBe(operatorUserId);
      expect(run?.approvedVersionId).toBe(run?.versionId);

      const rerunStep = run?.Steps.find((step) => step.action === "RERUN_CHECK");
      const noteStep = run?.Steps.find((step) => step.action === "ADD_INCIDENT_NOTE");
      const reviewStep = run?.Steps.find((step) => step.action === "REVIEW_HTTP_EXPECTED_STATUS");

      expect(rerunStep?.status).toBe("SUCCEEDED");
      expect(noteStep?.status).toBe("SUCCEEDED");
      expect(reviewStep?.status).toBe("ROLLED_BACK");

      const check = await prisma.check.findUnique({
        where: { id: checkId },
        select: { expectedStatusCode: true }
      });
      expect(check?.expectedStatusCode).toBe(503);

      const incident = await prisma.incident.findUnique({
        where: { id: incidentId },
        select: { status: true }
      });
      expect(incident?.status).not.toBe("RESOLVED");

      expect(run?.status).toBe("ROLLED_BACK");

      const reviewTimeline = await prisma.incidentTimelineEvent.findMany({
        where: { incidentId, sourceId: checkId, eventType: "REMEDIATION" },
        orderBy: { occurredAt: "asc" }
      });
      const steps = reviewTimeline.map((row) => (row.payloadJson as { step?: string } | null)?.step);
      expect(steps).toEqual(expect.arrayContaining(["APPROVED", "CONFIG_UPDATED", "VERIFICATION", "ROLLBACK"]));
    } finally {
      fetchMock.mockRestore();
    }
  });
});
