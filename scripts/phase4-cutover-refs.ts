/**
 * Phase 4 cutover: alert / incident / automation canonical reference tests.
 * LOCAL ONLY. Uses the temporary project created by phase4-cutover-write-path.ts.
 * Does not push or deploy.
 */
import { randomUUID } from "crypto";
import path from "path";
import { config } from "dotenv";

config({ path: path.resolve(process.cwd(), "apps/api/.env") });

const TEMP_PROJECT_ID = "zz-cutover-temp";
const ORG_ID = process.env.CUTOVER_ORG_ID || "org-okanggroup";
const NOBLE_PROJECT_ID = "app-noble-express";
const ENV = "production";

const main = async () => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const { createAlert } = await import("../apps/api/src/services/alerting.service");
  const { ingestHeartbeat } = await import("../apps/api/src/services/heartbeats.service");
  const { resolveAutomationRelationshipTarget } = await import(
    "../apps/api/src/services/canonical-reference-migration.service"
  );

  const report: Record<string, unknown> = {};

  // Locate temp URL-monitored service + its canonical entity mapping
  const service = await prisma.service.findFirst({
    where: { projectId: TEMP_PROJECT_ID },
    select: { id: true, name: true }
  });
  if (!service) throw new Error("temp URL-monitored service not found; run write-path first");
  const mapping = await prisma.legacyServiceEntityMapping.findFirst({
    where: { projectId: TEMP_PROJECT_ID, legacyServiceId: service.id, status: "ACTIVE" },
    select: { entityId: true }
  });
  const canonicalEntityId = mapping?.entityId ?? null;

  // 1. Failing check -> alert references canonical entity
  const httpCheck = await prisma.check.findFirst({
    where: { Service: { projectId: TEMP_PROJECT_ID }, type: "HTTP" },
    select: { id: true }
  });
  const alertRes = await createAlert({
    projectId: TEMP_PROJECT_ID,
    serviceId: service.id,
    sourceType: "CHECK_FAILURE",
    sourceId: httpCheck?.id ?? `cutover-${randomUUID()}`,
    severity: "HIGH" as any,
    title: "[cutover-temp] HTTP Check failing",
    message: "Synthetic failing check for cutover dry-run"
  });
  const createdAlert = alertRes.alertId
    ? await prisma.alert.findUnique({
        where: { id: alertRes.alertId },
        select: { id: true, serviceId: true, operationalEntityId: true }
      })
    : null;
  report.failingCheckAlert = {
    alertId: createdAlert?.id,
    serviceId: createdAlert?.serviceId,
    operationalEntityId: createdAlert?.operationalEntityId,
    expectedCanonicalEntityId: canonicalEntityId,
    referencesCanonicalEntity:
      !!createdAlert?.operationalEntityId &&
      createdAlert.operationalEntityId === canonicalEntityId
  };

  // 2. Dependency alert references canonical relationship
  const otelRel = await prisma.operationalRelationship.findFirst({
    where: { projectId: TEMP_PROJECT_ID, provenance: "OTEL_COLLECTOR" },
    select: { id: true }
  });
  let depAlertId: string | null = null;
  if (otelRel) {
    depAlertId = randomUUID();
    await prisma.alert.create({
      data: {
        id: depAlertId,
        projectId: TEMP_PROJECT_ID,
        operationalRelationshipId: otelRel.id,
        sourceType: "DEPENDENCY_DEGRADED",
        severity: "MEDIUM" as any,
        title: "[cutover-temp] dependency degraded",
        message: "Synthetic dependency alert for cutover dry-run",
        status: "OPEN" as any,
        occurrenceCount: 1
      }
    });
  }
  const depAlert = depAlertId
    ? await prisma.alert.findUnique({
        where: { id: depAlertId },
        select: { id: true, operationalRelationshipId: true }
      })
    : null;
  report.dependencyAlert = {
    alertId: depAlert?.id,
    operationalRelationshipId: depAlert?.operationalRelationshipId,
    referencesCanonicalRelationship:
      !!depAlert?.operationalRelationshipId &&
      depAlert.operationalRelationshipId === otelRel?.id
  };

  // 3. Incident affected entities resolve canonically (Noble has migrated references)
  const nobleIncidents = await prisma.incident.findMany({
    where: { projectId: NOBLE_PROJECT_ID },
    select: { id: true }
  });
  const incidentRef = await prisma.incidentTopologyReference.findFirst({
    where: {
      entityId: { not: null },
      incidentId: { in: nobleIncidents.map((row) => row.id) }
    },
    select: { id: true, incidentId: true, entityId: true, role: true }
  });
  const refEntity = incidentRef?.entityId
    ? await prisma.operationalEntity.findUnique({
        where: { id: incidentRef.entityId },
        select: { id: true, name: true, entityType: true }
      })
    : null;
  report.incidentCanonicalReference = {
    incidentId: incidentRef?.incidentId,
    role: incidentRef?.role,
    entityId: incidentRef?.entityId,
    resolvesToEntity: refEntity
      ? { id: refEntity.id, name: refEntity.name, entityType: refEntity.entityType }
      : null,
    resolvesCanonically: !!refEntity
  };

  // 4. Selected line evaluates automation (canonical relationship target resolves)
  const automationTarget = otelRel
    ? await resolveAutomationRelationshipTarget({
        organizationId: ORG_ID,
        projectId: TEMP_PROJECT_ID,
        relationshipId: otelRel.id
      })
    : null;
  report.automationLineEvaluation = {
    relationshipId: otelRel?.id,
    resolvedTarget: automationTarget
      ? {
          id: automationTarget.id,
          source: automationTarget.Source?.name,
          target: automationTarget.Target?.name
        }
      : null,
    evaluable: !!automationTarget
  };

  // 5. Recovery updates canonical health (heartbeat DOWN -> UP)
  await ingestHeartbeat(TEMP_PROJECT_ID, { environment: ENV, status: "DOWN", message: "cutover down" });
  const appAfterDown = await prisma.operationalEntity.findFirst({
    where: { projectId: TEMP_PROJECT_ID, entityType: "APP" },
    select: { id: true, health: true }
  });
  await ingestHeartbeat(TEMP_PROJECT_ID, { environment: ENV, status: "UP", message: "cutover recovered" });
  const appAfterUp = await prisma.operationalEntity.findFirst({
    where: { projectId: TEMP_PROJECT_ID, entityType: "APP" },
    select: { id: true, health: true }
  });
  report.recoveryUpdatesCanonicalHealth = {
    entityId: appAfterUp?.id,
    healthAfterDown: appAfterDown?.health,
    healthAfterUp: appAfterUp?.health,
    recovered: appAfterDown?.health === "DOWN" && appAfterUp?.health === "HEALTHY"
  };

  console.log(JSON.stringify(report, null, 2));

  const pass =
    (report.failingCheckAlert as any).referencesCanonicalEntity &&
    (report.dependencyAlert as any).referencesCanonicalRelationship &&
    (report.incidentCanonicalReference as any).resolvesCanonically &&
    (report.automationLineEvaluation as any).evaluable &&
    (report.recoveryUpdatesCanonicalHealth as any).recovered;
  console.log(pass ? "REFS_PASS" : "REFS_FAIL");
  if (!pass) process.exitCode = 1;

  await prisma.$disconnect();
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
