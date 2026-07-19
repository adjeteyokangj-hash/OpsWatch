import { createHash } from "crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

export type CanonicalGraphClient = PrismaClient | Prisma.TransactionClient;

export type CanonicalGraphContext = {
  organizationId: string;
  projectId?: string | null;
  environment: string;
};

export type CanonicalEntityWrite = CanonicalGraphContext & {
  entityType: string;
  stableKey: string;
  name: string;
  source: string;
  sourceKey?: string;
  provenance: string;
  operationalLocationId?: string | null;
  criticality?: string;
  health?: string;
  healthReason?: string | null;
  healthConfidence?: number | null;
  observedAt?: Date;
  freshUntil?: Date | null;
  confirmationState?: string;
  manuallyManaged?: boolean;
  sharedScope?: "PROJECT" | "ORGANIZATION";
  isTestSeed?: boolean;
  confidence?: number | null;
  tags?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
  compatibilityEntityId?: string;
  legacyServiceId?: string;
  evidenceCount?: number;
  incrementEvidence?: boolean;
};

export type CanonicalRelationshipWrite = CanonicalGraphContext & {
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: string;
  source: string;
  provenance: string;
  observedAt?: Date;
  freshUntil?: Date | null;
  health?: string;
  confidence?: number | null;
  criticality?: string;
  impactRole?: string;
  confirmationState?: string;
  manuallyManaged?: boolean;
  approvalStatus?: string;
  requiresApproval?: boolean;
  discoveryState?: string;
  evidence?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
  automationCapabilities?: Prisma.InputJsonValue;
  compatibilityRelationshipId?: string;
  evidenceCount?: number;
  incrementEvidence?: boolean;
  latencyP95Ms?: number | null;
  errorRate?: number | null;
};

export class GraphIdentityConflictError extends Error {
  readonly code = "GRAPH_IDENTITY_CONFLICT";

  constructor(
    message: string,
    readonly context: Record<string, string | null | undefined>
  ) {
    super(message);
    this.name = "GraphIdentityConflictError";
  }
}

const normalizeSegment = (value: string): string =>
  value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");

export const canonicalProjectScopeKey = (
  projectId: string | null | undefined,
  sharedScope: "PROJECT" | "ORGANIZATION" = "PROJECT"
): string => (sharedScope === "ORGANIZATION" ? "" : projectId ?? "");

export const canonicalEntityIdentityKey = (input: {
  entityType: string;
  stableKey: string;
}): string => `${normalizeSegment(input.entityType)}:${normalizeSegment(input.stableKey)}`;

export const canonicalRelationshipIdentityKey = (input: {
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: string;
}): string =>
  `${normalizeSegment(input.relationshipType)}:${input.sourceEntityId}:${input.targetEntityId}`;

const deterministicId = (prefix: string, parts: string[]): string =>
  `${prefix}_${createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 40)}`;

const safeEnvironment = (environment: string): string => {
  const normalized = normalizeSegment(environment || "unknown");
  return normalized || "unknown";
};

const safeSource = (source: string): string => source.trim().toUpperCase();

export class CanonicalGraphService {
  constructor(private readonly db: CanonicalGraphClient) {}

  async upsertEntity(input: CanonicalEntityWrite) {
    const environment = safeEnvironment(input.environment);
    const entityType = input.entityType.trim().toUpperCase();
    const sharedScope = input.sharedScope ?? "PROJECT";
    const projectScopeKey = canonicalProjectScopeKey(input.projectId, sharedScope);
    const stableIdentityKey = canonicalEntityIdentityKey({
      entityType,
      stableKey: input.stableKey
    });
    const observedAt = input.observedAt ?? new Date();
    const source = safeSource(input.source);
    const sourceKey = normalizeSegment(input.sourceKey ?? input.stableKey);

    if (sharedScope === "PROJECT" && !input.projectId) {
      throw new GraphIdentityConflictError("Project-scoped entities require projectId", {
        organizationId: input.organizationId,
        environment,
        stableIdentityKey
      });
    }

    const project = input.projectId
      ? await this.db.project.findUnique({
          where: { id: input.projectId },
          select: { organizationId: true, environment: true }
        })
      : null;
    if (project && project.organizationId !== input.organizationId) {
      throw new GraphIdentityConflictError("Entity scope does not match project scope", {
        organizationId: input.organizationId,
        projectId: input.projectId,
        environment
      });
    }

    const deterministicEntityId = deterministicId("oge", [
      input.organizationId,
      projectScopeKey,
      environment,
      entityType,
      stableIdentityKey
    ]);
    const [canonicalExisting, compatibilityExisting] = await Promise.all([
      this.db.operationalEntity.findUnique({
        where: {
          organizationId_projectScopeKey_environment_entityType_stableIdentityKey: {
            organizationId: input.organizationId,
            projectScopeKey,
            environment,
            entityType,
            stableIdentityKey
          }
        },
        select: { id: true }
      }),
      input.compatibilityEntityId
        ? this.db.operationalEntity.findUnique({
            where: { id: input.compatibilityEntityId },
            select: {
              id: true,
              organizationId: true,
              projectId: true,
              entityType: true,
              stableIdentityKey: true
            }
          })
        : null
    ]);
    if (
      canonicalExisting &&
      compatibilityExisting &&
      canonicalExisting.id !== compatibilityExisting.id
    ) {
      throw new GraphIdentityConflictError(
        "Canonical identity and compatibility identity resolve to different entities",
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          environment,
          canonicalEntityId: canonicalExisting.id,
          compatibilityEntityId: compatibilityExisting.id
        }
      );
    }
    if (
      compatibilityExisting &&
      (compatibilityExisting.organizationId !== input.organizationId ||
        compatibilityExisting.projectId !== (input.projectId ?? null))
    ) {
      throw new GraphIdentityConflictError("Compatibility entity crosses scope", {
        organizationId: input.organizationId,
        projectId: input.projectId,
        compatibilityEntityId: compatibilityExisting.id
      });
    }
    const id =
      canonicalExisting?.id ??
      compatibilityExisting?.id ??
      input.compatibilityEntityId ??
      deterministicEntityId;
    const effectiveEntityType =
      compatibilityExisting?.entityType ?? entityType;
    const effectiveStableIdentityKey =
      compatibilityExisting?.stableIdentityKey ?? stableIdentityKey;
    const existingAlias = await this.db.operationalEntityIdentity.findUnique({
      where: {
        organizationId_projectScopeKey_environment_source_sourceKey: {
          organizationId: input.organizationId,
          projectScopeKey,
          environment,
          source,
          sourceKey
        }
      },
      select: { entityId: true }
    });
    if (existingAlias && existingAlias.entityId !== id) {
      throw new GraphIdentityConflictError("Source identity already maps to another entity", {
        organizationId: input.organizationId,
        projectId: input.projectId,
        environment,
        source,
        sourceKey,
        entityId: existingAlias.entityId
      });
    }

    const entity =
      canonicalExisting || compatibilityExisting
        ? await this.db.operationalEntity.update({
            where: { id },
            data: {
              projectScopeKey,
              environment,
              entityType: effectiveEntityType,
              name: input.name.trim(),
              stableIdentityKey: effectiveStableIdentityKey,
              legacyServiceId: input.legacyServiceId,
              operationalLocationId: input.operationalLocationId,
              lastSeenAt: observedAt,
              freshUntil: input.freshUntil,
              staleAt: null,
              inactiveAt: null,
              signalCount:
                input.evidenceCount !== undefined
                  ? input.evidenceCount
                  : input.incrementEvidence === false
                    ? undefined
                    : { increment: 1 },
              health: input.health,
              healthReason: input.healthReason,
              healthConfidence: input.healthConfidence,
              criticality: input.criticality,
              confirmationState: input.confirmationState,
              manuallyManaged: input.manuallyManaged,
              isTestSeed: input.isTestSeed,
              tagsJson: input.tags,
              metadataJson: input.metadata,
              discoveryState: "ACTIVE",
              updatedAt: observedAt
            }
          })
        : await this.db.operationalEntity.create({
            data: {
        id,
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        projectScopeKey,
        environment,
        operationalLocationId: input.operationalLocationId ?? null,
        entityType,
        name: input.name.trim(),
        externalId: `${source}:${sourceKey}`,
        stableIdentityKey,
        legacyServiceId: input.legacyServiceId,
        criticality: input.criticality ?? "MEDIUM",
        health: input.health ?? "UNKNOWN",
        healthReason: input.healthReason ?? null,
        healthConfidence: input.healthConfidence ?? null,
        provenance: input.provenance,
        discoverySource: source,
        discoveredAt: observedAt,
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
        freshUntil: input.freshUntil ?? null,
        signalCount:
          input.evidenceCount ?? (input.incrementEvidence === false ? 0 : 1),
        discoveryState: "ACTIVE",
        confirmationState: input.confirmationState ?? "CONFIRMED",
        manuallyManaged: input.manuallyManaged ?? false,
        sharedScope,
        isTestSeed: input.isTestSeed ?? false,
        tagsJson: input.tags,
        metadataJson: input.metadata,
        updatedAt: observedAt
            }
          });

    await this.db.operationalEntityIdentity.upsert({
      where: {
        organizationId_projectScopeKey_environment_source_sourceKey: {
          organizationId: input.organizationId,
          projectScopeKey,
          environment,
          source,
          sourceKey
        }
      },
      create: {
        id: deterministicId("ogi", [
          input.organizationId,
          projectScopeKey,
          environment,
          source,
          sourceKey
        ]),
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        projectScopeKey,
        environment,
        source,
        sourceKey,
        entityId: entity.id,
        confidence: input.confidence ?? null,
        confirmed: (input.confirmationState ?? "CONFIRMED") === "CONFIRMED",
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
        metadataJson: input.metadata,
        updatedAt: observedAt
      },
      update: {
        entityId: entity.id,
        confidence: input.confidence,
        confirmed: input.confirmationState === "CONFIRMED" ? true : undefined,
        lastSeenAt: observedAt,
        metadataJson: input.metadata,
        updatedAt: observedAt
      }
    });
    return entity;
  }

  async upsertRelationship(input: CanonicalRelationshipWrite) {
    if (input.sourceEntityId === input.targetEntityId) {
      throw new GraphIdentityConflictError("Self relationships are not canonical", {
        sourceEntityId: input.sourceEntityId,
        targetEntityId: input.targetEntityId
      });
    }
    const environment = safeEnvironment(input.environment);
    const projectScopeKey = canonicalProjectScopeKey(input.projectId);
    const endpoints = await this.db.operationalEntity.findMany({
      where: { id: { in: [input.sourceEntityId, input.targetEntityId] } },
      select: {
        id: true,
        organizationId: true,
        projectScopeKey: true,
        environment: true
      }
    });
    if (
      endpoints.length !== 2 ||
      endpoints.some(
        (entity) =>
          entity.organizationId !== input.organizationId ||
          entity.environment !== environment ||
          (entity.projectScopeKey !== "" && entity.projectScopeKey !== projectScopeKey)
      )
    ) {
      throw new GraphIdentityConflictError("Relationship endpoints cross canonical scope", {
        organizationId: input.organizationId,
        projectId: input.projectId,
        environment,
        sourceEntityId: input.sourceEntityId,
        targetEntityId: input.targetEntityId
      });
    }

    const relationshipType = input.relationshipType.trim().toUpperCase();
    const stableIdentityKey = canonicalRelationshipIdentityKey({
      sourceEntityId: input.sourceEntityId,
      targetEntityId: input.targetEntityId,
      relationshipType
    });
    const observedAt = input.observedAt ?? new Date();
    const deterministicRelationshipId = deterministicId("ogr", [
      input.organizationId,
      projectScopeKey,
      environment,
      stableIdentityKey
    ]);
    const [canonicalExisting, compatibilityExisting] = await Promise.all([
      this.db.operationalRelationship.findUnique({
        where: {
          organizationId_projectScopeKey_environment_stableIdentityKey: {
            organizationId: input.organizationId,
            projectScopeKey,
            environment,
            stableIdentityKey
          }
        },
        select: { id: true }
      }),
      input.compatibilityRelationshipId
        ? this.db.operationalRelationship.findUnique({
            where: { id: input.compatibilityRelationshipId },
            select: {
              id: true,
              organizationId: true,
              projectId: true,
              sourceEntityId: true,
              targetEntityId: true
            }
          })
        : null
    ]);
    if (
      canonicalExisting &&
      compatibilityExisting &&
      canonicalExisting.id !== compatibilityExisting.id
    ) {
      throw new GraphIdentityConflictError(
        "Canonical and compatibility relationship identities differ",
        {
          canonicalRelationshipId: canonicalExisting.id,
          compatibilityRelationshipId: compatibilityExisting.id
        }
      );
    }
    if (
      compatibilityExisting &&
      (compatibilityExisting.organizationId !== input.organizationId ||
        compatibilityExisting.projectId !== (input.projectId ?? null) ||
        compatibilityExisting.sourceEntityId !== input.sourceEntityId ||
        compatibilityExisting.targetEntityId !== input.targetEntityId)
    ) {
      throw new GraphIdentityConflictError("Compatibility relationship crosses scope", {
        compatibilityRelationshipId: compatibilityExisting.id,
        organizationId: input.organizationId,
        projectId: input.projectId
      });
    }
    const id =
      canonicalExisting?.id ??
      compatibilityExisting?.id ??
      input.compatibilityRelationshipId ??
      deterministicRelationshipId;

    if (canonicalExisting || compatibilityExisting) {
      return this.db.operationalRelationship.update({
        where: { id },
        data: {
          projectScopeKey,
          environment,
          relationshipType,
          stableIdentityKey,
          lastObservedAt: observedAt,
          freshUntil: input.freshUntil,
          staleAt: null,
          inactiveAt: null,
          observationCount:
            input.evidenceCount !== undefined
              ? input.evidenceCount
              : input.incrementEvidence === false
                ? undefined
                : { increment: 1 },
          health: input.health,
          confidence: input.confidence,
          criticality: input.criticality,
          impactRole: input.impactRole,
          evidenceJson: input.evidence,
          latencyP95Ms: input.latencyP95Ms,
          errorRate: input.errorRate,
          metadataJson: input.metadata,
          automationCapabilitiesJson: input.automationCapabilities,
          discoveryState: input.discoveryState,
          approvalStatus: input.approvalStatus,
          confirmationState: input.confirmationState,
          updatedAt: observedAt
        }
      });
    }

    return this.db.operationalRelationship.create({
      data: {
        id,
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        projectScopeKey,
        environment,
        sourceEntityId: input.sourceEntityId,
        targetEntityId: input.targetEntityId,
        relationshipType,
        stableIdentityKey,
        provenance: input.provenance,
        approvalStatus: input.approvalStatus ?? "APPROVED",
        requiresApproval: input.requiresApproval ?? false,
        criticality: input.criticality ?? "MEDIUM",
        impactRole: input.impactRole ?? "REQUIRED",
        confidence: input.confidence ?? null,
        evidenceJson: input.evidence,
        latencyP95Ms: input.latencyP95Ms ?? null,
        errorRate: input.errorRate ?? null,
        discoveredAt: observedAt,
        firstSeenAt: observedAt,
        lastObservedAt: observedAt,
        freshUntil: input.freshUntil ?? null,
        discoveryState: input.discoveryState ?? "DISCOVERED",
        health: input.health ?? "UNKNOWN",
        confirmationState: input.confirmationState ?? "CONFIRMED",
        manuallyManaged: input.manuallyManaged ?? false,
        automationCapabilitiesJson: input.automationCapabilities,
        metadataJson: input.metadata,
        observationCount:
          input.evidenceCount ?? (input.incrementEvidence === false ? 0 : 1),
        updatedAt: observedAt
      }
    });
  }

  async mapLegacyService(input: CanonicalGraphContext & {
    legacyServiceId: string;
    entityId: string;
  }) {
    if (!input.projectId) {
      throw new GraphIdentityConflictError("Legacy Service mapping requires projectId", {
        legacyServiceId: input.legacyServiceId
      });
    }
    const environment = safeEnvironment(input.environment);
    const [service, entity, mappings] = await Promise.all([
      this.db.service.findUnique({
        where: { id: input.legacyServiceId },
        select: { projectId: true }
      }),
      this.db.operationalEntity.findUnique({
        where: { id: input.entityId },
        select: {
          organizationId: true,
          projectId: true,
          environment: true,
          stableIdentityKey: true
        }
      }),
      this.db.legacyServiceEntityMapping.findMany({
        where: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          environment,
          legacyServiceId: input.legacyServiceId,
          status: "ACTIVE"
        },
        select: { id: true, entityId: true }
      })
    ]);
    if (
      !service ||
      !entity ||
      service.projectId !== input.projectId ||
      entity.organizationId !== input.organizationId ||
      entity.projectId !== input.projectId ||
      entity.environment !== environment ||
      !entity.stableIdentityKey
    ) {
      throw new GraphIdentityConflictError("Legacy Service mapping scope mismatch", {
        organizationId: input.organizationId,
        projectId: input.projectId,
        environment,
        legacyServiceId: input.legacyServiceId,
        entityId: input.entityId
      });
    }
    const conflicting = mappings.filter((mapping) => mapping.entityId !== input.entityId);
    if (conflicting.length > 0) {
      await this.db.legacyServiceEntityMapping.updateMany({
        where: { id: { in: [...conflicting.map((row) => row.id)] } },
        data: {
          status: "AMBIGUOUS",
          conflictReason: `Conflicts with canonical entity ${input.entityId}`,
          updatedAt: new Date()
        }
      });
      throw new GraphIdentityConflictError("Ambiguous legacy Service mapping", {
        organizationId: input.organizationId,
        projectId: input.projectId,
        environment,
        legacyServiceId: input.legacyServiceId,
        entityId: input.entityId
      });
    }
    return this.db.legacyServiceEntityMapping.upsert({
      where: {
        organizationId_projectId_environment_legacyServiceId_entityId: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          environment,
          legacyServiceId: input.legacyServiceId,
          entityId: input.entityId
        }
      },
      create: {
        id: deterministicId("ogm", [
          input.organizationId,
          input.projectId,
          environment,
          input.legacyServiceId,
          input.entityId
        ]),
        organizationId: input.organizationId,
        projectId: input.projectId,
        environment,
        legacyServiceId: input.legacyServiceId,
        entityId: input.entityId,
        entityIdentityKey: entity.stableIdentityKey,
        status: "ACTIVE",
        updatedAt: new Date()
      },
      update: {
        entityIdentityKey: entity.stableIdentityKey,
        status: "ACTIVE",
        conflictReason: null,
        updatedAt: new Date()
      }
    });
  }

  async resolveLegacyService(input: CanonicalGraphContext & { legacyServiceId: string }) {
    if (!input.projectId) return null;
    const rows = await this.db.legacyServiceEntityMapping.findMany({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        environment: safeEnvironment(input.environment),
        legacyServiceId: input.legacyServiceId,
        status: "ACTIVE"
      },
      select: { entityId: true }
    });
    if (rows.length > 1) {
      throw new GraphIdentityConflictError("Ambiguous legacy Service mapping", {
        organizationId: input.organizationId,
        projectId: input.projectId,
        environment: input.environment,
        legacyServiceId: input.legacyServiceId
      });
    }
    return rows[0]?.entityId ?? null;
  }

  async mapLegacyRelationship(input: CanonicalGraphContext & {
    legacyServiceDependencyId: string;
    relationshipId: string;
  }) {
    if (!input.projectId) {
      throw new GraphIdentityConflictError(
        "Legacy ServiceDependency mapping requires projectId",
        { legacyServiceDependencyId: input.legacyServiceDependencyId }
      );
    }
    const environment = safeEnvironment(input.environment);
    const [dependency, relationship, mappings] = await Promise.all([
      this.db.serviceDependency.findUnique({
        where: { id: input.legacyServiceDependencyId },
        select: { projectId: true }
      }),
      this.db.operationalRelationship.findUnique({
        where: { id: input.relationshipId },
        select: {
          organizationId: true,
          projectId: true,
          environment: true,
          stableIdentityKey: true
        }
      }),
      this.db.legacyDependencyRelationshipMapping.findMany({
        where: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          environment,
          legacyServiceDependencyId: input.legacyServiceDependencyId,
          status: "ACTIVE"
        },
        select: { id: true, relationshipId: true }
      })
    ]);
    if (
      !dependency ||
      !relationship ||
      dependency.projectId !== input.projectId ||
      relationship.organizationId !== input.organizationId ||
      relationship.projectId !== input.projectId ||
      relationship.environment !== environment ||
      !relationship.stableIdentityKey
    ) {
      throw new GraphIdentityConflictError(
        "Legacy ServiceDependency mapping scope mismatch",
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          environment,
          legacyServiceDependencyId: input.legacyServiceDependencyId,
          relationshipId: input.relationshipId
        }
      );
    }
    const conflicting = mappings.filter(
      (mapping) => mapping.relationshipId !== input.relationshipId
    );
    if (conflicting.length > 0) {
      await this.db.legacyDependencyRelationshipMapping.updateMany({
        where: { id: { in: conflicting.map((row) => row.id) } },
        data: {
          status: "AMBIGUOUS",
          conflictReason: `Conflicts with canonical relationship ${input.relationshipId}`,
          updatedAt: new Date()
        }
      });
      throw new GraphIdentityConflictError(
        "Ambiguous legacy ServiceDependency mapping",
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          environment,
          legacyServiceDependencyId: input.legacyServiceDependencyId,
          relationshipId: input.relationshipId
        }
      );
    }
    return this.db.legacyDependencyRelationshipMapping.upsert({
      where: {
        organizationId_projectId_environment_legacyServiceDependencyId_relationshipId:
          {
            organizationId: input.organizationId,
            projectId: input.projectId,
            environment,
            legacyServiceDependencyId: input.legacyServiceDependencyId,
            relationshipId: input.relationshipId
          }
      },
      create: {
        id: deterministicId("ogdm", [
          input.organizationId,
          input.projectId,
          environment,
          input.legacyServiceDependencyId,
          input.relationshipId
        ]),
        organizationId: input.organizationId,
        projectId: input.projectId,
        environment,
        legacyServiceDependencyId: input.legacyServiceDependencyId,
        relationshipId: input.relationshipId,
        relationshipIdentityKey: relationship.stableIdentityKey,
        status: "ACTIVE",
        updatedAt: new Date()
      },
      update: {
        relationshipIdentityKey: relationship.stableIdentityKey,
        status: "ACTIVE",
        conflictReason: null,
        updatedAt: new Date()
      }
    });
  }
}

export const createCanonicalGraphService = (
  db: CanonicalGraphClient
): CanonicalGraphService => new CanonicalGraphService(db);
