import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import { createAlert } from "./alerting.service";
import { createMaintenanceWindow, cancelMaintenanceWindow, transitionMaintenanceWindowStatuses } from "./maintenance-windows.service";
import { runIncidentAutoHeal } from "./remediation/auto-heal.service";
import { executeReviewHttpExpectedStatus } from "./remediation/executors/review-http-expected-status.executor";
import { ensureE2EOrgPlan } from "./test-helpers/e2e-org-plan";

const enabled = process.env.RUN_DATABASE_E2E === "true";

describe.runIf(enabled)("maintenance window production smoke", () => {
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const serviceId = randomUUID();
  const userId = randomUUID();
  const checkId = randomUUID();
  const incidentId = randomUUID();

  beforeAll(async () => {
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Maintenance Smoke Org",
        slug: `maintenance-smoke-${organizationId}`,
        updatedAt: new Date()
      }
    });
    await ensureE2EOrgPlan(organizationId, "BUSINESS");
    await prisma.user.create({
      data: {
        id: userId,
        name: "Maint Operator",
        email: `maint-${userId}@example.com`,
        passwordHash: "hash",
        role: "ADMIN",
        organizationId,
        updatedAt: new Date()
      }
    });
    await prisma.project.create({
      data: {
        id: projectId,
        name: "Maintenance Smoke Project",
        slug: `maint-${projectId}`,
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
        name: "API",
        type: "API",
        updatedAt: new Date()
      }
    });
    await prisma.check.create({
      data: {
        id: checkId,
        serviceId,
        name: "HTTP check",
        type: "HTTP",
        intervalSeconds: 300,
        timeoutMs: 1000,
        expectedStatusCode: 200,
        isActive: true,
        updatedAt: new Date()
      }
    });
    const alertId = randomUUID();
    await prisma.alert.create({
      data: {
        id: alertId,
        projectId,
        serviceId,
        sourceType: "CHECK",
        sourceId: checkId,
        severity: "HIGH",
        title: "Linked auto-heal alert",
        message: "Failure for auto-heal maintenance gate"
      }
    });
    await prisma.incident.create({
      data: {
        id: incidentId,
        projectId,
        title: "Maintenance smoke incident",
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
    process.env.AUTO_REMEDIATION_ENABLED = "true";
    process.env.AUTO_HEAL_DEFAULT_ENABLED = "true";
  });

  afterAll(async () => {
    await prisma.maintenanceWindow.deleteMany({ where: { organizationId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it("schedules, activates, suppresses alerts, blocks auto-heal, and completes windows", async () => {
    const startsAt = new Date(Date.now() - 60_000);
    const endsAt = new Date(Date.now() + 5 * 60_000);

    const scheduled = await createMaintenanceWindow({
      organizationId,
      projectId,
      name: "Smoke window",
      startsAt: new Date(Date.now() + 60_000),
      endsAt: new Date(Date.now() + 10 * 60_000),
      suppressAlerts: true,
      suppressIncidents: true,
      allowAutonomous: false,
      serviceIds: [serviceId],
      createdById: userId
    });
    expect(scheduled.status).toBe("SCHEDULED");

    const active = await createMaintenanceWindow({
      organizationId,
      projectId,
      name: "Active smoke window",
      startsAt,
      endsAt,
      suppressAlerts: true,
      suppressIncidents: true,
      allowAutonomous: false,
      serviceIds: [serviceId],
      createdById: userId
    });
    expect(active.status).toBe("ACTIVE");

    await createAlert({
      projectId,
      serviceId,
      sourceType: "CHECK",
      sourceId: checkId,
      severity: "HIGH",
      title: "Maintenance suppressed alert",
      message: "Synthetic failure during maintenance"
    });

    const suppressedAlert = await prisma.alert.findFirst({
      where: { projectId, title: "Maintenance suppressed alert" },
      orderBy: { firstSeenAt: "desc" }
    });
    expect(suppressedAlert?.maintenanceSuppressed).toBe(true);
    expect(suppressedAlert?.status).toBe("RESOLVED");
    expect(suppressedAlert?.maintenanceWindowId).toBe(active.id);

    const autoHeal = await runIncidentAutoHeal(organizationId, incidentId);
    expect(autoHeal.attempted).toBe(false);
    expect(autoHeal.blockedReason?.toLowerCase()).toContain("maintenance");

    const cancelled = await cancelMaintenanceWindow({
      organizationId,
      id: scheduled.id,
      cancelledById: userId
    });
    expect(cancelled.status).toBe("CANCELLED");

    await prisma.maintenanceWindow.update({
      where: { id: active.id },
      data: { endsAt: new Date(Date.now() - 1_000), updatedAt: new Date() }
    });
    const transition = await transitionMaintenanceWindowStatuses();
    expect(transition.completed).toBeGreaterThanOrEqual(1);

    const completed = await prisma.maintenanceWindow.findUnique({ where: { id: active.id } });
    expect(completed?.status).toBe("COMPLETED");

    await createAlert({
      projectId,
      serviceId,
      sourceType: "CHECK",
      sourceId: checkId,
      severity: "HIGH",
      title: "Post-maintenance alert",
      message: "Should remain open after maintenance"
    });
    const openAlert = await prisma.alert.findFirst({
      where: { projectId, title: "Post-maintenance alert" },
      orderBy: { firstSeenAt: "desc" }
    });
    expect(openAlert?.maintenanceSuppressed).toBe(false);
    expect(openAlert?.status).toBe("OPEN");
  });

  it("rejects cross-tenant HTTP check review mutations", async () => {
    const otherOrgId = randomUUID();
    const otherProjectId = randomUUID();
    const otherServiceId = randomUUID();
    const otherCheckId = randomUUID();
    const otherIncidentId = randomUUID();

    await prisma.organization.create({
      data: { id: otherOrgId, name: "Other Org", slug: `other-${otherOrgId}`, updatedAt: new Date() }
    });
    await prisma.project.create({
      data: {
        id: otherProjectId,
        name: "Other Project",
        slug: `other-${otherProjectId}`,
        clientName: "Other",
        environment: "test",
        apiKey: randomUUID(),
        signingSecret: randomUUID(),
        organizationId: otherOrgId,
        updatedAt: new Date()
      }
    });
    await prisma.service.create({
      data: {
        id: otherServiceId,
        projectId: otherProjectId,
        name: "Other API",
        type: "API",
        baseUrl: "http://127.0.0.1:9",
        updatedAt: new Date()
      }
    });
    await prisma.check.create({
      data: {
        id: otherCheckId,
        serviceId: otherServiceId,
        name: "Other check",
        type: "HTTP",
        intervalSeconds: 300,
        timeoutMs: 1000,
        expectedStatusCode: 503,
        isActive: true,
        updatedAt: new Date()
      }
    });
    await prisma.incident.create({
      data: { id: otherIncidentId, projectId: otherProjectId, title: "Other incident", severity: "HIGH" }
    });

    const result = await executeReviewHttpExpectedStatus({
      context: {
        organizationId,
        incidentId: otherIncidentId,
        checkId: otherCheckId,
        extra: {
          newExpectedStatusCode: 200,
          approvalReason: "Cross-tenant attempt",
          actualStatusCode: 200
        }
      }
    });

    expect(result.success).toBe(false);
    expect(result.summary.toLowerCase()).toContain("no active http check");

    const untouched = await prisma.check.findUnique({
      where: { id: otherCheckId },
      select: { expectedStatusCode: true }
    });
    expect(untouched?.expectedStatusCode).toBe(503);

    await prisma.project.deleteMany({ where: { id: otherProjectId } });
    await prisma.organization.deleteMany({ where: { id: otherOrgId } });
  });
});
