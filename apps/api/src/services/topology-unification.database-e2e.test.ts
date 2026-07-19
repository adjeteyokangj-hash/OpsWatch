import { randomUUID } from "crypto";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env" });
const enabled = process.env.RUN_DATABASE_E2E === "true";

describe.runIf(enabled)("canonical topology unification", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let backfillCanonicalTopology: typeof import("./topology-unification.service").backfillCanonicalTopology;
  let compareLegacyAndCanonicalTopology: typeof import("./topology-unification.service").compareLegacyAndCanonicalTopology;
  let migrateCanonicalReferences: typeof import("./canonical-reference-migration.service").migrateCanonicalReferences;
  let loadCanonicalProjectTopology: typeof import("./canonical-topology-loader.service").loadCanonicalProjectTopology;
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const serviceAId = randomUUID();
  const serviceBId = randomUUID();
  const dependencyId = randomUUID();
  const alertId = randomUUID();

  beforeAll(async () => {
    ({ prisma } = await import("../lib/prisma"));
    ({ backfillCanonicalTopology, compareLegacyAndCanonicalTopology } =
      await import("./topology-unification.service"));
    ({ migrateCanonicalReferences } =
      await import("./canonical-reference-migration.service"));
    ({ loadCanonicalProjectTopology } =
      await import("./canonical-topology-loader.service"));

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Phase 4 E2E",
        slug: `phase4-${organizationId}`,
        updatedAt: new Date()
      }
    });
    await prisma.project.create({
      data: {
        id: projectId,
        organizationId,
        name: "Phase 4 Test Project",
        slug: `phase4-test-${projectId}`,
        clientName: "E2E",
        environment: "test",
        apiKey: randomUUID(),
        signingSecret: randomUUID(),
        updatedAt: new Date()
      }
    });
    await prisma.service.createMany({
      data: [
        {
          id: serviceAId,
          projectId,
          name: "Checkout",
          type: "APP",
          status: "HEALTHY",
          updatedAt: new Date()
        },
        {
          id: serviceBId,
          projectId,
          name: "Payments",
          type: "COMPONENT",
          status: "DEGRADED",
          updatedAt: new Date()
        }
      ]
    });
    await prisma.serviceDependency.create({
      data: {
        id: dependencyId,
        projectId,
        fromServiceId: serviceAId,
        toServiceId: serviceBId,
        dependencyType: "RUNTIME",
        criticality: "HIGH",
        updatedAt: new Date()
      }
    });
    await prisma.alert.create({
      data: {
        id: alertId,
        projectId,
        serviceId: serviceBId,
        sourceType: "CHECK",
        severity: "HIGH",
        title: "Payments degraded",
        message: "Phase 4 canonical reference test"
      }
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it("backfills idempotently and preserves the topology response contract", async () => {
    const first = await backfillCanonicalTopology({ projectId });
    const entityCountAfterFirst = await prisma.operationalEntity.count({
      where: { projectId }
    });
    const relationshipCountAfterFirst =
      await prisma.operationalRelationship.count({ where: { projectId } });
    const second = await backfillCanonicalTopology({ projectId });

    expect(first.conflicts).toEqual([]);
    expect(second.conflicts).toEqual([]);
    expect(
      await prisma.operationalEntity.count({ where: { projectId } })
    ).toBe(entityCountAfterFirst);
    expect(
      await prisma.operationalRelationship.count({ where: { projectId } })
    ).toBe(relationshipCountAfterFirst);

    const comparison = await compareLegacyAndCanonicalTopology(projectId);
    expect(comparison.missingEntities).toEqual([]);
    expect(comparison.missingRelationships).toEqual([]);
    expect(comparison.ambiguousMappings).toEqual([]);

    const referenceReport = await migrateCanonicalReferences({ projectId });
    expect(referenceReport.unresolved).toEqual([]);
    expect(
      (await prisma.alert.findUnique({ where: { id: alertId } }))
        ?.operationalEntityId
    ).toBeTruthy();

    const topology = await loadCanonicalProjectTopology({
      organizationId,
      project: {
        id: projectId,
        name: "Phase 4 Test Project",
        status: "HEALTHY"
      }
    });
    expect(topology.nodes).toHaveLength(2);
    expect(topology.edges).toHaveLength(1);
    expect(topology.summary.openAlerts).toBe(1);
    expect(
      topology.nodeContext[topology.nodes[0]!.id]?.canonical
    ).toBeDefined();
  });
});
