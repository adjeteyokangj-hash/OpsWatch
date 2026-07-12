import { randomUUID } from "crypto";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env" });
const enabled = process.env.RUN_DATABASE_E2E === "true";

describe.runIf(enabled)("project topology API", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let loadProjectTopology: (organizationId: string, projectId: string) => Promise<import("../types/dto").ProjectTopologyResponse | null>;
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const projectId = randomUUID();
  const otherProjectId = randomUUID();
  const appId = randomUUID();
  const moduleId = randomUUID();
  const redisId = randomUUID();
  const otherServiceId = randomUUID();

  beforeAll(async () => {
    ({ prisma } = await import("../lib/prisma"));
    ({ loadProjectTopology } = await import("./topology-loader.service"));

    await prisma.organization.createMany({
      data: [
        { id: organizationId, name: "Topology E2E", slug: `topology-${organizationId}`, updatedAt: new Date() },
        { id: otherOrganizationId, name: "Other Org", slug: `other-${otherOrganizationId}`, updatedAt: new Date() }
      ]
    });
    await prisma.project.createMany({
      data: [
        {
          id: projectId,
          name: "Topology Project",
          slug: `topology-${projectId}`,
          clientName: "E2E",
          environment: "test",
          apiKey: randomUUID(),
          signingSecret: randomUUID(),
          organizationId,
          updatedAt: new Date()
        },
        {
          id: otherProjectId,
          name: "Other Project",
          slug: `other-${otherProjectId}`,
          clientName: "E2E",
          environment: "test",
          apiKey: randomUUID(),
          signingSecret: randomUUID(),
          organizationId: otherOrganizationId,
          updatedAt: new Date()
        }
      ]
    });
    await prisma.service.createMany({
      data: [
        { id: appId, projectId, name: "Noble Express", type: "APP", updatedAt: new Date() },
        { id: moduleId, projectId, name: "Quotes", type: "MODULE", updatedAt: new Date() },
        { id: redisId, projectId, name: "Redis", type: "COMPONENT", updatedAt: new Date() },
        { id: otherServiceId, projectId: otherProjectId, name: "Other API", type: "API", updatedAt: new Date() }
      ]
    });
    await prisma.serviceDependency.createMany({
      data: [
        {
          id: randomUUID(),
          projectId,
          fromServiceId: moduleId,
          toServiceId: appId,
          dependencyType: "HIERARCHY",
          criticality: "HIGH",
          updatedAt: new Date()
        },
        {
          id: randomUUID(),
          projectId,
          fromServiceId: moduleId,
          toServiceId: redisId,
          dependencyType: "RUNTIME",
          criticality: "CRITICAL",
          updatedAt: new Date()
        }
      ]
    });
    const checkId = randomUUID();
    await prisma.check.create({
      data: {
        id: checkId,
        serviceId: moduleId,
        name: "Quotes health",
        type: "HTTP",
        intervalSeconds: 60,
        timeoutMs: 5000,
        updatedAt: new Date(),
        CheckResult: {
          create: {
            id: randomUUID(),
            status: "PASS",
            responseTimeMs: 120,
            checkedAt: new Date()
          }
        }
      }
    });
    await prisma.alert.create({
      data: {
        id: randomUUID(),
        projectId,
        serviceId: moduleId,
        sourceType: "CHECK",
        severity: "HIGH",
        title: "Quote latency",
        message: "slow"
      }
    });
    await prisma.incident.create({
      data: {
        id: randomUUID(),
        projectId,
        severity: "HIGH",
        title: "Quote incident",
        status: "OPEN"
      }
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.project.deleteMany({ where: { id: { in: [projectId, otherProjectId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
    await prisma.$disconnect();
  });

  it("returns hierarchy and dependency edges with org isolation", async () => {
    const topology = await loadProjectTopology(organizationId, projectId);
    expect(topology).not.toBeNull();
    expect(topology!.nodes).toHaveLength(3);
    expect(topology!.edges.some((row) => row.type === "HIERARCHY")).toBe(true);
    expect(topology!.edges.some((row) => row.type === "DEPENDENCY")).toBe(true);
    expect(topology!.nodes.find((row) => row.id === redisId)?.status).toBe("UNKNOWN");
    expect(topology!.summary.openAlerts).toBe(1);
    expect(topology!.summary.openIncidents).toBe(1);
    expect(await loadProjectTopology(otherOrganizationId, projectId)).toBeNull();
    expect(await loadProjectTopology(organizationId, otherProjectId)).toBeNull();
  });
});
