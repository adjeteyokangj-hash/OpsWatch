import { randomUUID } from "crypto";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: "../api/.env" });
const enabled = process.env.RUN_DATABASE_E2E === "true";

describe.runIf(enabled)("organization incident correlation", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let correlateOrganizationIncidents: () => Promise<number>;
  const organizationId = randomUUID();
  const projectAId = randomUUID();
  const projectBId = randomUUID();
  const serviceAId = randomUUID();
  const serviceBId = randomUUID();
  const alertAId = randomUUID();
  const alertBId = randomUUID();

  beforeAll(async () => {
    ({ prisma } = await import("../lib/prisma"));
    ({ correlateOrganizationIncidents } = await import("./org-incident-correlation"));

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Org Correlation E2E",
        slug: `org-corr-${organizationId}`,
        updatedAt: new Date()
      }
    });
    await prisma.project.createMany({
      data: [
        {
          id: projectAId,
          name: "Noble Express",
          slug: `ne-${projectAId}`,
          clientName: "E2E",
          environment: "test",
          apiKey: randomUUID(),
          signingSecret: randomUUID(),
          organizationId,
          updatedAt: new Date()
        },
        {
          id: projectBId,
          name: "TrueNumeris",
          slug: `tn-${projectBId}`,
          clientName: "E2E",
          environment: "test",
          apiKey: randomUUID(),
          signingSecret: randomUUID(),
          organizationId,
          updatedAt: new Date()
        }
      ]
    });
    await prisma.service.createMany({
      data: [
        { id: serviceAId, projectId: projectAId, name: "Redis", type: "DATABASE", updatedAt: new Date() },
        { id: serviceBId, projectId: projectBId, name: "Redis", type: "DATABASE", updatedAt: new Date() }
      ]
    });
    await prisma.alert.createMany({
      data: [
        {
          id: alertAId,
          projectId: projectAId,
          serviceId: serviceAId,
          sourceType: "CHECK",
          severity: "CRITICAL",
          title: "Redis unreachable",
          message: "connection refused"
        },
        {
          id: alertBId,
          projectId: projectBId,
          serviceId: serviceBId,
          sourceType: "CHECK",
          severity: "HIGH",
          title: "Redis cache unavailable",
          message: "upstream dependency failed"
        }
      ]
    });

    const incidentAId = randomUUID();
    const incidentBId = randomUUID();
    await prisma.incident.createMany({
      data: [
        {
          id: incidentAId,
          projectId: projectAId,
          severity: "CRITICAL",
          title: "Noble Express Redis outage",
          openedAt: new Date()
        },
        {
          id: incidentBId,
          projectId: projectBId,
          severity: "HIGH",
          title: "TrueNumeris Redis outage",
          openedAt: new Date()
        }
      ]
    });
    await prisma.incidentAlert.createMany({
      data: [
        { incidentId: incidentAId, alertId: alertAId },
        { incidentId: incidentBId, alertId: alertBId }
      ]
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.project.deleteMany({ where: { id: { in: [projectAId, projectBId] } } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it("groups open incidents across projects when infrastructure signatures match", async () => {
    const created = await correlateOrganizationIncidents();
    expect(created).toBe(1);

    const incidents = await prisma.incident.findMany({
      where: { projectId: { in: [projectAId, projectBId] } },
      include: { IncidentTimelineEvent: true }
    });
    expect(incidents.every((row) => row.correlationGroupId)).toBe(true);
    expect(new Set(incidents.map((row) => row.correlationGroupId)).size).toBe(1);
    expect(incidents.every((row) => row.IncidentTimelineEvent.some((ev) => ev.eventType === "ORG_CORRELATION"))).toBe(
      true
    );
  });
});
