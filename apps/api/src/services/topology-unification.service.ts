import {
  GraphIdentityConflictError,
  canonicalEntityIdentityKey,
  createCanonicalGraphService
} from "@opswatch/shared";
import { prisma } from "../lib/prisma";

export type TopologyUnificationConflict = {
  kind: string;
  projectId: string;
  legacyId: string;
  message: string;
  context?: Record<string, string | null | undefined>;
};

export type TopologyBackfillReport = {
  projects: number;
  entitiesMapped: number;
  relationshipsMapped: number;
  collisionsDetected: TopologyUnificationConflict[];
  collisionsRepaired: number;
  conflicts: TopologyUnificationConflict[];
};

const canonicalHealthFromLegacy = (status: string): string => {
  if (status === "UP") return "HEALTHY";
  if (status === "PAUSED") return "DISABLED";
  return status;
};

const isTestSeedProject = (project: {
  environment: string;
  name: string;
  slug: string;
}): boolean =>
  /^(test|testing)$/i.test(project.environment) ||
  /(^|[-_\s])(test|fixture|playwright|pw)([-_\s]|$)/i.test(
    `${project.name} ${project.slug}`
  );

export const backfillCanonicalTopology = async (options?: {
  projectId?: string;
}): Promise<TopologyBackfillReport> => {
  const projects = await prisma.project.findMany({
    where: {
      organizationId: { not: null },
      ...(options?.projectId ? { id: options.projectId } : {})
    },
    select: {
      id: true,
      organizationId: true,
      environment: true,
      name: true,
      slug: true,
      operationalLocationId: true,
      Service: { orderBy: { createdAt: "asc" } },
      ServiceDependency: { orderBy: { createdAt: "asc" } }
    },
    orderBy: { id: "asc" }
  });

  const report: TopologyBackfillReport = {
    projects: projects.length,
    entitiesMapped: 0,
    relationshipsMapped: 0,
    collisionsDetected: [],
    collisionsRepaired: 0,
    conflicts: []
  };

  for (const project of projects) {
    const organizationId = project.organizationId!;
    const graph = createCanonicalGraphService(prisma);
    const entityByLegacyService = new Map<string, string>();

    for (const service of project.Service) {
      try {
        let compatibilityEntity =
          await prisma.operationalEntity.findUnique({
            where: { legacyServiceId: service.id },
            select: {
              id: true,
              organizationId: true,
              projectId: true,
              environment: true,
              metadataJson: true
            }
          });
        if (
          compatibilityEntity &&
          (compatibilityEntity.organizationId !== organizationId ||
            compatibilityEntity.projectId !== project.id)
        ) {
          report.collisionsDetected.push({
            kind: "CROSS_SCOPE_LEGACY_SERVICE_POINTER",
            projectId: project.id,
            legacyId: service.id,
            message:
              `Detached legacyServiceId from ${compatibilityEntity.id}; ` +
              `entity belongs to project ${compatibilityEntity.projectId ?? "none"}`
          });
          await prisma.operationalEntity.update({
            where: { id: compatibilityEntity.id },
            data: {
              legacyServiceId: null,
              metadataJson: {
                ...(compatibilityEntity.metadataJson &&
                typeof compatibilityEntity.metadataJson === "object" &&
                !Array.isArray(compatibilityEntity.metadataJson)
                  ? compatibilityEntity.metadataJson
                  : {}),
                legacyPointerDetachedBy: "PHASE_4_BACKFILL",
                legacyPointerDetachedAt: new Date().toISOString(),
                detachedLegacyServiceId: service.id
              },
              updatedAt: new Date()
            }
          });
          report.collisionsRepaired += 1;
          compatibilityEntity = null;
        }
        const entity = await graph.upsertEntity({
          organizationId,
          projectId: project.id,
          environment: project.environment,
          entityType: service.type,
          stableKey: `legacy-service:${service.id}`,
          name: service.name,
          source: "SERVICE_BACKFILL",
          sourceKey: service.id,
          provenance: "DECLARED",
          operationalLocationId: project.operationalLocationId,
          criticality: service.criticality,
          health: canonicalHealthFromLegacy(service.status),
          confirmationState: "CONFIRMED",
          manuallyManaged: true,
          isTestSeed: isTestSeedProject(project),
          metadata: {
            legacyServiceId: service.id,
            backfillSource: "PHASE_4"
          },
          compatibilityEntityId: compatibilityEntity?.id,
          legacyServiceId: service.id,
          incrementEvidence: false
        });
        await graph.mapLegacyService({
          organizationId,
          projectId: project.id,
          environment: project.environment,
          legacyServiceId: service.id,
          entityId: entity.id
        });
        entityByLegacyService.set(service.id, entity.id);
        report.entitiesMapped += 1;
      } catch (error) {
        report.conflicts.push({
          kind: "LEGACY_SERVICE_MAPPING",
          projectId: project.id,
          legacyId: service.id,
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof GraphIdentityConflictError
            ? { context: error.context }
            : {})
        });
      }
    }

    for (const dependency of project.ServiceDependency) {
      const sourceEntityId = entityByLegacyService.get(dependency.fromServiceId);
      const targetEntityId = entityByLegacyService.get(dependency.toServiceId);
      if (!sourceEntityId || !targetEntityId) {
        report.conflicts.push({
          kind: "MISSING_DEPENDENCY_ENDPOINT",
          projectId: project.id,
          legacyId: dependency.id,
          message: "One or both legacy dependency endpoints are not mapped"
        });
        continue;
      }
      try {
        const compatibilityRelationship =
          await prisma.operationalRelationship.findFirst({
            where: {
              OR: [
                { id: `legacy-dependency:${dependency.id}` },
                {
                  organizationId,
                  sourceEntityId,
                  targetEntityId,
                  relationshipType: dependency.dependencyType
                }
              ]
            },
            select: { id: true }
          });
        const relationship = await graph.upsertRelationship({
          organizationId,
          projectId: project.id,
          environment: project.environment,
          sourceEntityId,
          targetEntityId,
          relationshipType: dependency.dependencyType,
          source: "SERVICE_DEPENDENCY_BACKFILL",
          provenance: dependency.source === "MANUAL" ? "DECLARED" : "DISCOVERED",
          observedAt: dependency.lastObservedAt ?? dependency.createdAt,
          health: "UNKNOWN",
          confidence: dependency.evidenceStrength,
          criticality: dependency.criticality,
          approvalStatus: "APPROVED",
          confirmationState:
            dependency.evidenceCount > 0 ? "CONFIRMED" : "DECLARED",
          manuallyManaged: dependency.source === "MANUAL",
          discoveryState:
            dependency.evidenceCount > 0 ? "DISCOVERED" : "DECLARED",
          evidenceCount: dependency.evidenceCount,
          incrementEvidence: false,
          evidence: {
            legacyServiceDependencyId: dependency.id,
            evidenceCount: dependency.evidenceCount,
            source: dependency.source
          },
          compatibilityRelationshipId: compatibilityRelationship?.id
        });
        await graph.mapLegacyRelationship({
          organizationId,
          projectId: project.id,
          environment: project.environment,
          legacyServiceDependencyId: dependency.id,
          relationshipId: relationship.id
        });
        report.relationshipsMapped += 1;
      } catch (error) {
        report.conflicts.push({
          kind: "LEGACY_DEPENDENCY_MAPPING",
          projectId: project.id,
          legacyId: dependency.id,
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof GraphIdentityConflictError
            ? { context: error.context }
            : {})
        });
      }
    }
  }
  return report;
};

export type TopologyComparisonReport = {
  projectId: string | null;
  legacyEntityCount: number;
  canonicalEntityCount: number;
  legacyRelationshipCount: number;
  canonicalRelationshipCount: number;
  missingEntities: string[];
  missingRelationships: string[];
  duplicates: Array<{ identity: string; count: number }>;
  ambiguousMappings: Array<{ kind: string; legacyId: string }>;
  healthDifferences: Array<{
    legacyServiceId: string;
    legacyHealth: string;
    canonicalHealth: string;
  }>;
};

export const compareLegacyAndCanonicalTopology = async (
  projectId?: string
): Promise<TopologyComparisonReport> => {
  const projectFilter = projectId ? { projectId } : {};
  const [
    services,
    dependencies,
    entities,
    relationships,
    serviceMappings,
    dependencyMappings
  ] = await Promise.all([
    prisma.service.findMany({
      where: projectId ? { projectId } : {},
      select: { id: true, type: true, status: true }
    }),
    prisma.serviceDependency.findMany({
      where: projectId ? { projectId } : {},
      select: { id: true }
    }),
    prisma.operationalEntity.findMany({
      where: projectFilter,
      select: {
        id: true,
        organizationId: true,
        projectScopeKey: true,
        environment: true,
        entityType: true,
        stableIdentityKey: true,
        health: true
      }
    }),
    prisma.operationalRelationship.findMany({
      where: projectFilter,
      select: { id: true }
    }),
    prisma.legacyServiceEntityMapping.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        status: { in: ["ACTIVE", "AMBIGUOUS"] }
      },
      select: {
        legacyServiceId: true,
        entityId: true,
        status: true,
        Entity: { select: { health: true } }
      }
    }),
    prisma.legacyDependencyRelationshipMapping.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        status: { in: ["ACTIVE", "AMBIGUOUS"] }
      },
      select: {
        legacyServiceDependencyId: true,
        relationshipId: true,
        status: true
      }
    })
  ]);

  const mappedServices = new Set(
    serviceMappings
      .filter((mapping) => mapping.status === "ACTIVE")
      .map((mapping) => mapping.legacyServiceId)
  );
  const mappedDependencies = new Set(
    dependencyMappings
      .filter((mapping) => mapping.status === "ACTIVE")
      .map((mapping) => mapping.legacyServiceDependencyId)
  );
  const identityCounts = new Map<string, number>();
  for (const entity of entities) {
    if (!entity.stableIdentityKey) continue;
    const identity = [
      entity.organizationId,
      entity.projectScopeKey,
      entity.environment,
      entity.entityType,
      entity.stableIdentityKey
    ].join("|");
    identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
  }
  const serviceById = new Map(services.map((service) => [service.id, service]));
  const healthDifferences = serviceMappings.flatMap((mapping) => {
    const service = serviceById.get(mapping.legacyServiceId);
    if (!service || mapping.status !== "ACTIVE") return [];
    const expected = canonicalHealthFromLegacy(service.status);
    return expected === mapping.Entity.health
      ? []
      : [
          {
            legacyServiceId: service.id,
            legacyHealth: service.status,
            canonicalHealth: mapping.Entity.health
          }
        ];
  });

  return {
    projectId: projectId ?? null,
    legacyEntityCount: services.length,
    canonicalEntityCount: entities.length,
    legacyRelationshipCount: dependencies.length,
    canonicalRelationshipCount: relationships.length,
    missingEntities: services
      .filter((service) => !mappedServices.has(service.id))
      .map((service) => service.id),
    missingRelationships: dependencies
      .filter((dependency) => !mappedDependencies.has(dependency.id))
      .map((dependency) => dependency.id),
    duplicates: [...identityCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([identity, count]) => ({ identity, count })),
    ambiguousMappings: [
      ...serviceMappings
        .filter((mapping) => mapping.status === "AMBIGUOUS")
        .map((mapping) => ({
          kind: "SERVICE",
          legacyId: mapping.legacyServiceId
        })),
      ...dependencyMappings
        .filter((mapping) => mapping.status === "AMBIGUOUS")
        .map((mapping) => ({
          kind: "DEPENDENCY",
          legacyId: mapping.legacyServiceDependencyId
        }))
    ],
    healthDifferences
  };
};

export const expectedLegacyServiceIdentity = (service: {
  id: string;
  type: string;
}): string =>
  canonicalEntityIdentityKey({
    entityType: service.type,
    stableKey: `legacy-service:${service.id}`
  });
