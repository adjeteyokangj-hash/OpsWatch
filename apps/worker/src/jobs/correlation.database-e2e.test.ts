import { randomUUID } from "crypto";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: "../api/.env" });
const enabled = process.env.RUN_DATABASE_E2E === "true";

describe.runIf(enabled)("database-backed incident correlation lifecycle", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let runCorrelation: () => Promise<void>;
  let resolveIncidents: () => Promise<void>;
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const otherOrganizationId = randomUUID();
  const otherProjectId = randomUUID();
  const upstreamId = randomUUID();
  const downstreamId = randomUUID();
  const unrelatedId = randomUUID();
  const otherServiceId = randomUUID();
  const relatedAlertIds = [randomUUID(), randomUUID()];

  beforeAll(async () => {
    ({ prisma } = await import("../lib/prisma"));
    ({ runIncidentCorrelationJob: runCorrelation } = await import("./run-incident-correlation.job"));
    ({ resolveIncidentsJob: resolveIncidents } = await import("./resolve-incidents.job"));
    await prisma.organization.createMany({ data: [
      { id: organizationId, name: "Correlation E2E", slug: `correlation-${organizationId}`, updatedAt: new Date() },
      { id: otherOrganizationId, name: "Isolation E2E", slug: `isolation-${otherOrganizationId}`, updatedAt: new Date() }
    ] });
    await prisma.project.createMany({ data: [
      { id: projectId, name: "Correlation project", slug: `project-${projectId}`, clientName: "E2E", environment: "test", apiKey: randomUUID(), signingSecret: randomUUID(), organizationId, updatedAt: new Date() },
      { id: otherProjectId, name: "Other tenant", slug: `project-${otherProjectId}`, clientName: "E2E", environment: "test", apiKey: randomUUID(), signingSecret: randomUUID(), organizationId: otherOrganizationId, updatedAt: new Date() }
    ] });
    await prisma.service.createMany({ data: [
      { id: upstreamId, projectId, name: "Database", type: "DATABASE", updatedAt: new Date() },
      { id: downstreamId, projectId, name: "API", type: "API", updatedAt: new Date() },
      { id: unrelatedId, projectId, name: "Email", type: "EMAIL", updatedAt: new Date() },
      { id: otherServiceId, projectId: otherProjectId, name: "Other API", type: "API", updatedAt: new Date() }
    ] });
    await prisma.serviceDependency.create({ data: { id: randomUUID(), projectId, fromServiceId: downstreamId, toServiceId: upstreamId, dependencyType: "RUNTIME", criticality: "CRITICAL", updatedAt: new Date() } });
    await prisma.alert.createMany({ data: [
      { id: relatedAlertIds[0]!, projectId, serviceId: upstreamId, sourceType: "CHECK", severity: "CRITICAL", title: "Database unavailable", message: "failed" },
      { id: relatedAlertIds[1]!, projectId, serviceId: downstreamId, sourceType: "CHECK", severity: "HIGH", title: "API unavailable", message: "failed" },
      { id: randomUUID(), projectId, serviceId: unrelatedId, sourceType: "CHECK", severity: "HIGH", title: "Email unavailable", message: "failed" },
      { id: randomUUID(), projectId: otherProjectId, serviceId: otherServiceId, sourceType: "CHECK", severity: "HIGH", title: "Other tenant unavailable", message: "failed" }
    ] });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.project.deleteMany({ where: { id: { in: [projectId, otherProjectId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
    await prisma.$disconnect();
  });

  it("correlates connected alerts, separates unrelated and tenant data, records evidence, and resolves on recovery", async () => {
    await runCorrelation();
    const incidents = await prisma.incident.findMany({ where: { projectId }, include: { IncidentAlert: true, IncidentTimelineEvent: true } });
    expect(incidents).toHaveLength(2);
    const related = incidents.find(row => row.IncidentAlert.length === 2)!;
    expect(new Set(related.IncidentAlert.map(row => row.alertId))).toEqual(new Set(relatedAlertIds));
    expect(related.IncidentTimelineEvent.some(row => row.eventType === "DEPENDENCY_RISK")).toBe(true);
    expect(await prisma.incident.count({ where: { projectId: otherProjectId } })).toBe(1);

    await prisma.alert.updateMany({ where: { id: { in: relatedAlertIds } }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    await runCorrelation();
    await resolveIncidents();
    const resolved = await prisma.incident.findUnique({ where: { id: related.id }, include: { IncidentTimelineEvent: true } });
    expect(resolved?.status).toBe("RESOLVED");
    expect(resolved?.IncidentTimelineEvent.filter(row => row.eventType === "ALERT_RECOVERED")).toHaveLength(2);
    expect(resolved?.IncidentTimelineEvent.some(row => row.eventType === "INCIDENT_RESOLVED")).toBe(true);
  });
});
