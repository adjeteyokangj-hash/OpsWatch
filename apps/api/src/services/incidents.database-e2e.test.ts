import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import { listIncidentRootCauseCandidates } from "./incidents.service";

const enabled = process.env.RUN_DATABASE_E2E === "true";
describe.runIf(enabled)("database-backed root-cause ranking", () => {
  const organizationId = randomUUID(); const otherOrganizationId = randomUUID(); const projectId = randomUUID();
  const upstreamId = randomUUID(); const downstreamId = randomUUID(); const incidentId = randomUUID(); const dependencyId = randomUUID();
  beforeAll(async () => {
    await prisma.organization.createMany({ data: [
      { id: organizationId, name: "Ranking E2E", slug: `ranking-${organizationId}`, updatedAt: new Date() },
      { id: otherOrganizationId, name: "Other E2E", slug: `other-${otherOrganizationId}`, updatedAt: new Date() }
    ] });
    await prisma.project.create({ data: { id: projectId, name: "Ranking", slug: `ranking-${projectId}`, clientName: "E2E", environment: "test", apiKey: randomUUID(), signingSecret: randomUUID(), organizationId, updatedAt: new Date() } });
    await prisma.service.createMany({ data: [
      { id: upstreamId, projectId, name: "Primary database", type: "DATABASE", updatedAt: new Date() },
      { id: downstreamId, projectId, name: "Public API", type: "API", updatedAt: new Date() }
    ] });
    await prisma.serviceDependency.create({ data: { id: dependencyId, projectId, fromServiceId: downstreamId, toServiceId: upstreamId, dependencyType: "DATA", criticality: "CRITICAL", updatedAt: new Date() } });
    const alerts = [
      { id: randomUUID(), projectId, serviceId: upstreamId, sourceType: "CHECK", severity: "CRITICAL" as const, title: "Database failed", message: "failure" },
      { id: randomUUID(), projectId, serviceId: downstreamId, sourceType: "CHECK", severity: "HIGH" as const, title: "API failed", message: "failure" }
    ];
    await prisma.alert.createMany({ data: alerts });
    await prisma.incident.create({ data: { id: incidentId, projectId, title: "Dependency incident", severity: "CRITICAL", IncidentAlert: { create: alerts.map(row => ({ alertId: row.id })) } } });
  });
  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
    await prisma.$disconnect();
  });
  it("ranks critical upstream dependency evidence first and enforces organization isolation", async () => {
    const candidates = await listIncidentRootCauseCandidates(organizationId, incidentId);
    expect(candidates?.[0]).toMatchObject({ kind: "DEPENDENCY", referenceId: dependencyId });
    expect(await listIncidentRootCauseCandidates(otherOrganizationId, incidentId)).toBeNull();
  });
});
