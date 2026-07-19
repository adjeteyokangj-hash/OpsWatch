import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";

export type CanonicalReferenceMigrationReport = {
  alertsUpdated: number;
  incidentsUpdated: number;
  incidentReferencesCreated: number;
  remediationLogsUpdated: number;
  automationRunsUpdated: number;
  automationStepsUpdated: number;
  unresolved: Array<{
    kind: string;
    id: string;
    legacyId?: string;
    reason: string;
  }>;
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const resolveLegacyEntity = async (input: {
  organizationId: string;
  projectId: string;
  environment: string;
  legacyServiceId: string;
}): Promise<{ entityId: string | null; ambiguous: boolean }> => {
  const mappings = await prisma.legacyServiceEntityMapping.findMany({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      legacyServiceId: input.legacyServiceId,
      status: "ACTIVE"
    },
    select: { entityId: true, environment: true }
  });
  const exact = mappings.filter(
    (mapping) => mapping.environment === input.environment.toLowerCase()
  );
  const candidates = exact.length > 0 ? exact : mappings;
  const entityIds = [...new Set(candidates.map((mapping) => mapping.entityId))];
  return {
    entityId: entityIds.length === 1 ? entityIds[0]! : null,
    ambiguous: entityIds.length > 1
  };
};

const ensureIncidentReference = async (input: {
  incidentId: string;
  entityId?: string;
  relationshipId?: string;
  role: string;
  source: string;
  confidence?: number | null;
}): Promise<boolean> => {
  const existing = await prisma.incidentTopologyReference.findFirst({
    where: {
      incidentId: input.incidentId,
      entityId: input.entityId ?? null,
      relationshipId: input.relationshipId ?? null,
      role: input.role
    },
    select: { id: true }
  });
  if (existing) return false;
  await prisma.incidentTopologyReference.create({
    data: {
      id: randomUUID(),
      incidentId: input.incidentId,
      entityId: input.entityId ?? null,
      relationshipId: input.relationshipId ?? null,
      role: input.role,
      source: input.source,
      confidence: input.confidence ?? null,
      updatedAt: new Date()
    }
  });
  return true;
};

export const migrateCanonicalReferences = async (options?: {
  projectId?: string;
}): Promise<CanonicalReferenceMigrationReport> => {
  const projects = await prisma.project.findMany({
    where: {
      organizationId: { not: null },
      ...(options?.projectId ? { id: options.projectId } : {})
    },
    select: { id: true, organizationId: true, environment: true }
  });
  const report: CanonicalReferenceMigrationReport = {
    alertsUpdated: 0,
    incidentsUpdated: 0,
    incidentReferencesCreated: 0,
    remediationLogsUpdated: 0,
    automationRunsUpdated: 0,
    automationStepsUpdated: 0,
    unresolved: []
  };

  for (const project of projects) {
    const organizationId = project.organizationId!;
    const alerts = await prisma.alert.findMany({
      where: { projectId: project.id },
      select: {
        id: true,
        serviceId: true,
        operationalEntityId: true,
        operationalRelationshipId: true,
        OtelAlertEvidence: {
          select: { entityId: true, relationshipId: true }
        }
      }
    });
    for (const alert of alerts) {
      const evidenceEntityIds = [
        ...new Set(
          alert.OtelAlertEvidence.flatMap((row) =>
            row.entityId ? [row.entityId] : []
          )
        )
      ];
      const evidenceRelationshipIds = [
        ...new Set(
          alert.OtelAlertEvidence.flatMap((row) =>
            row.relationshipId ? [row.relationshipId] : []
          )
        )
      ];
      let entityId = alert.operationalEntityId;
      if (!entityId && evidenceEntityIds.length === 1) {
        entityId = evidenceEntityIds[0]!;
      }
      if (!entityId && alert.serviceId) {
        const resolved = await resolveLegacyEntity({
          organizationId,
          projectId: project.id,
          environment: project.environment,
          legacyServiceId: alert.serviceId
        });
        entityId = resolved.entityId;
        if (resolved.ambiguous) {
          report.unresolved.push({
            kind: "ALERT",
            id: alert.id,
            legacyId: alert.serviceId,
            reason: "ambiguous legacy Service mapping"
          });
        }
      }
      const relationshipId =
        alert.operationalRelationshipId ??
        (evidenceRelationshipIds.length === 1
          ? evidenceRelationshipIds[0]!
          : null);
      if (entityId || relationshipId) {
        await prisma.alert.update({
          where: { id: alert.id },
          data: {
            operationalEntityId: entityId,
            operationalRelationshipId: relationshipId
          }
        });
        report.alertsUpdated += 1;
      } else if (alert.serviceId) {
        report.unresolved.push({
          kind: "ALERT",
          id: alert.id,
          legacyId: alert.serviceId,
          reason: "no canonical entity mapping"
        });
      }
    }

    const incidents = await prisma.incident.findMany({
      where: { projectId: project.id },
      select: {
        id: true,
        rootCauseEntityId: true,
        rootCauseRelationshipId: true,
        IncidentAlert: {
          select: {
            Alert: {
              select: {
                operationalEntityId: true,
                operationalRelationshipId: true
              }
            }
          }
        },
        OtelIncidentEvidence: {
          select: {
            entityId: true,
            relationshipId: true,
            candidateRootCause: true,
            confidence: true
          }
        }
      }
    });
    for (const incident of incidents) {
      const affectedEntityIds = new Set(
        incident.IncidentAlert.flatMap((reference) =>
          reference.Alert.operationalEntityId
            ? [reference.Alert.operationalEntityId]
            : []
        )
      );
      const affectedRelationshipIds = new Set(
        incident.IncidentAlert.flatMap((reference) =>
          reference.Alert.operationalRelationshipId
            ? [reference.Alert.operationalRelationshipId]
            : []
        )
      );
      for (const evidence of incident.OtelIncidentEvidence) {
        if (evidence.entityId) affectedEntityIds.add(evidence.entityId);
        if (evidence.relationshipId) {
          affectedRelationshipIds.add(evidence.relationshipId);
        }
      }
      for (const entityId of affectedEntityIds) {
        if (
          await ensureIncidentReference({
            incidentId: incident.id,
            entityId,
            role: "AFFECTED",
            source: "PHASE_4_MIGRATION"
          })
        ) {
          report.incidentReferencesCreated += 1;
        }
      }
      for (const relationshipId of affectedRelationshipIds) {
        if (
          await ensureIncidentReference({
            incidentId: incident.id,
            relationshipId,
            role: "AFFECTED",
            source: "PHASE_4_MIGRATION"
          })
        ) {
          report.incidentReferencesCreated += 1;
        }
      }
      const rootEvidence = incident.OtelIncidentEvidence.filter(
        (evidence) => evidence.candidateRootCause
      );
      const rootEntityIds = [
        ...new Set(
          rootEvidence.flatMap((evidence) =>
            evidence.entityId ? [evidence.entityId] : []
          )
        )
      ];
      const rootRelationshipIds = [
        ...new Set(
          rootEvidence.flatMap((evidence) =>
            evidence.relationshipId ? [evidence.relationshipId] : []
          )
        )
      ];
      const rootCauseEntityId =
        incident.rootCauseEntityId ??
        (rootEntityIds.length === 1 ? rootEntityIds[0]! : null);
      const rootCauseRelationshipId =
        incident.rootCauseRelationshipId ??
        (rootRelationshipIds.length === 1
          ? rootRelationshipIds[0]!
          : null);
      if (rootCauseEntityId || rootCauseRelationshipId) {
        await prisma.incident.update({
          where: { id: incident.id },
          data: { rootCauseEntityId, rootCauseRelationshipId }
        });
        report.incidentsUpdated += 1;
      }
    }

    const remediationLogs = await prisma.remediationLog.findMany({
      where: {
        projectId: project.id,
        serviceId: { not: null },
        operationalEntityId: null
      },
      select: { id: true, serviceId: true }
    });
    for (const log of remediationLogs) {
      const resolved = await resolveLegacyEntity({
        organizationId,
        projectId: project.id,
        environment: project.environment,
        legacyServiceId: log.serviceId!
      });
      if (resolved.entityId) {
        await prisma.remediationLog.update({
          where: { id: log.id },
          data: { operationalEntityId: resolved.entityId }
        });
        report.remediationLogsUpdated += 1;
      } else {
        report.unresolved.push({
          kind: "REMEDIATION_LOG",
          id: log.id,
          legacyId: log.serviceId!,
          reason: resolved.ambiguous
            ? "ambiguous legacy Service mapping"
            : "no canonical entity mapping"
        });
      }
    }

    const runs = await prisma.automationRun.findMany({
      where: { projectId: project.id },
      select: {
        id: true,
        affectedServiceIds: true,
        affectedEntityIds: true,
        Steps: {
          select: {
            id: true,
            targetServiceId: true,
            targetEntityId: true
          }
        }
      }
    });
    for (const run of runs) {
      const affectedEntityIds = new Set(stringArray(run.affectedEntityIds));
      for (const serviceId of stringArray(run.affectedServiceIds)) {
        const resolved = await resolveLegacyEntity({
          organizationId,
          projectId: project.id,
          environment: project.environment,
          legacyServiceId: serviceId
        });
        if (resolved.entityId) affectedEntityIds.add(resolved.entityId);
        else {
          report.unresolved.push({
            kind: "AUTOMATION_RUN",
            id: run.id,
            legacyId: serviceId,
            reason: resolved.ambiguous
              ? "ambiguous legacy Service mapping"
              : "no canonical entity mapping"
          });
        }
      }
      await prisma.automationRun.update({
        where: { id: run.id },
        data: { affectedEntityIds: [...affectedEntityIds] }
      });
      report.automationRunsUpdated += 1;

      for (const step of run.Steps) {
        if (step.targetEntityId || !step.targetServiceId) continue;
        const resolved = await resolveLegacyEntity({
          organizationId,
          projectId: project.id,
          environment: project.environment,
          legacyServiceId: step.targetServiceId
        });
        if (resolved.entityId) {
          await prisma.automationRunStep.update({
            where: { id: step.id },
            data: { targetEntityId: resolved.entityId }
          });
          report.automationStepsUpdated += 1;
        } else {
          report.unresolved.push({
            kind: "AUTOMATION_STEP",
            id: step.id,
            legacyId: step.targetServiceId,
            reason: resolved.ambiguous
              ? "ambiguous legacy Service mapping"
              : "no canonical entity mapping"
          });
        }
      }
    }
  }
  return report;
};

export const resolveAutomationRelationshipTarget = async (input: {
  organizationId: string;
  projectId: string;
  relationshipId: string;
}) =>
  prisma.operationalRelationship.findFirst({
    where: {
      id: input.relationshipId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      lifecycle: "ACTIVE",
      approvalStatus: "APPROVED"
    },
    include: {
      Source: true,
      Target: true
    }
  });
