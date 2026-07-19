/**
 * Phase 4 cutover: inspect the source of legacy-mapping resolutions and OTEL presence.
 * LOCAL ONLY. Read-only.
 */
import path from "path";
import { config } from "dotenv";

config({ path: path.resolve(process.cwd(), "apps/api/.env") });

const projectId = process.env.CUTOVER_PROJECT_ID || "app-noble-express";

const main = async () => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, organizationId: true }
  });
  if (!project) throw new Error("project not found");

  const [
    alerts,
    sloDefs,
    incidents,
    otelEntities,
    otelRels,
    canonicalEntities,
    canonicalRels
  ] = await Promise.all([
    prisma.alert.findMany({
      where: { projectId, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      select: { id: true, title: true, serviceId: true, operationalEntityId: true }
    }),
    prisma.sLODefinition.findMany({
      where: { projectId, enabled: true, archivedAt: null },
      select: { id: true, name: true, serviceId: true }
    }),
    prisma.incident.findMany({
      where: { projectId, status: { in: ["OPEN", "INVESTIGATING", "MONITORING"] } },
      select: { id: true, title: true }
    }),
    prisma.operationalEntity.count({
      where: { projectId, discoverySource: "OTEL_BRIDGE" }
    }),
    prisma.operationalRelationship.count({
      where: { projectId, provenance: "OTEL_COLLECTOR" }
    }),
    prisma.operationalEntity.count({ where: { projectId } }),
    prisma.operationalRelationship.count({ where: { projectId } })
  ]);

  const alertsMissingCanonical = alerts.filter(
    (a) => !a.operationalEntityId && a.serviceId
  );

  console.log(
    JSON.stringify(
      {
        project,
        counts: {
          openAlerts: alerts.length,
          alertsMissingCanonicalRef: alertsMissingCanonical.length,
          sloDefs: sloDefs.length,
          sloWithServiceId: sloDefs.filter((s) => s.serviceId).length,
          openIncidents: incidents.length,
          otelEntities,
          otelRelationships: otelRels,
          canonicalEntities,
          canonicalRelationships: canonicalRels
        },
        alertsMissingCanonical,
        sloDefs
      },
      null,
      2
    )
  );

  await prisma.$disconnect();
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
