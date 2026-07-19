import { prisma } from "../lib/prisma";
import { compareLegacyAndCanonicalTopology } from "./topology-unification.service";

export type TopologyIntegrityFinding = {
  severity: "CRITICAL" | "WARNING";
  code: string;
  recordId?: string;
  message: string;
};

export type TopologyIntegrityReport = {
  generatedAt: string;
  counts: {
    activeEntities: number;
    activeRelationships: number;
    quarantinedRelationships: number;
    findings: number;
    critical: number;
    warnings: number;
  };
  findings: TopologyIntegrityFinding[];
  comparison: Awaited<ReturnType<typeof compareLegacyAndCanonicalTopology>>;
  passes: boolean;
};

export const auditCanonicalTopologyIntegrity =
  async (): Promise<TopologyIntegrityReport> => {
    const now = new Date();
    const [entities, relationships, quarantinedRelationships, comparison] =
      await Promise.all([
        prisma.operationalEntity.findMany({
          where: { lifecycle: "ACTIVE" },
          select: {
            id: true,
            organizationId: true,
            projectId: true,
            projectScopeKey: true,
            environment: true,
            entityType: true,
            stableIdentityKey: true,
            sharedScope: true,
            health: true,
            freshUntil: true,
            discoveryState: true,
            isTestSeed: true,
            discoverySource: true
          }
        }),
        prisma.operationalRelationship.findMany({
          where: { lifecycle: "ACTIVE" },
          include: {
            Source: {
              select: {
                id: true,
                organizationId: true,
                projectId: true,
                projectScopeKey: true,
                environment: true
              }
            },
            Target: {
              select: {
                id: true,
                organizationId: true,
                projectId: true,
                projectScopeKey: true,
                environment: true
              }
            }
          }
        }),
        prisma.operationalRelationship.count({
          where: {
            lifecycle: "INACTIVE",
            confirmationState: "CONFLICT"
          }
        }),
        compareLegacyAndCanonicalTopology()
      ]);
    const findings: TopologyIntegrityFinding[] = [];
    const identityCounts = new Map<string, string[]>();

    for (const entity of entities) {
      if (!entity.stableIdentityKey) {
        findings.push({
          severity: "CRITICAL",
          code: "ENTITY_IDENTITY_MISSING",
          recordId: entity.id,
          message: "Active canonical entity has no stable identity key"
        });
      } else {
        const key = [
          entity.organizationId,
          entity.projectScopeKey,
          entity.environment,
          entity.entityType,
          entity.stableIdentityKey
        ].join("|");
        identityCounts.set(key, [...(identityCounts.get(key) ?? []), entity.id]);
      }
      if (entity.sharedScope === "PROJECT" && !entity.projectId) {
        findings.push({
          severity: "CRITICAL",
          code: "PROJECT_SCOPE_MISSING",
          recordId: entity.id,
          message: "Project-scoped entity has no project"
        });
      }
      if (
        entity.health === "HEALTHY" &&
        (entity.discoveryState === "STALE" ||
          (entity.freshUntil != null && entity.freshUntil < now))
      ) {
        findings.push({
          severity: "CRITICAL",
          code: "STALE_ENTITY_HEALTHY",
          recordId: entity.id,
          message: "Stale entity is incorrectly marked Healthy"
        });
      }
      if (
        entity.isTestSeed &&
        ["OTEL_BRIDGE", "DISCOVERED_API"].includes(
          entity.discoverySource ?? ""
        )
      ) {
        findings.push({
          severity: "WARNING",
          code: "TEST_SEED_LIVE_PROVENANCE",
          recordId: entity.id,
          message: "Test/seed entity carries live discovery provenance"
        });
      }
    }
    for (const [identity, ids] of identityCounts) {
      if (ids.length > 1) {
        findings.push({
          severity: "CRITICAL",
          code: "DUPLICATE_ENTITY_IDENTITY",
          recordId: ids.join(","),
          message: `Duplicate canonical identity ${identity}`
        });
      }
    }

    for (const relationship of relationships) {
      if (!relationship.stableIdentityKey) {
        findings.push({
          severity: "CRITICAL",
          code: "RELATIONSHIP_IDENTITY_MISSING",
          recordId: relationship.id,
          message: "Active canonical relationship has no stable identity key"
        });
      }
      if (relationship.sourceEntityId === relationship.targetEntityId) {
        findings.push({
          severity: "CRITICAL",
          code: "SELF_RELATIONSHIP",
          recordId: relationship.id,
          message: "Canonical relationship points to itself"
        });
      }
      if (
        relationship.Source.organizationId !== relationship.organizationId ||
        relationship.Target.organizationId !== relationship.organizationId ||
        relationship.Source.environment !== relationship.environment ||
        relationship.Target.environment !== relationship.environment ||
        (relationship.projectId != null &&
          (relationship.Source.projectId !== relationship.projectId ||
            relationship.Target.projectId !== relationship.projectId))
      ) {
        findings.push({
          severity: "CRITICAL",
          code: "RELATIONSHIP_SCOPE_MISMATCH",
          recordId: relationship.id,
          message:
            "Relationship scope does not match both canonical endpoints"
        });
      }
      if (
        relationship.health === "HEALTHY" &&
        (relationship.discoveryState === "STALE" ||
          (relationship.freshUntil != null &&
            relationship.freshUntil < now))
      ) {
        findings.push({
          severity: "CRITICAL",
          code: "STALE_RELATIONSHIP_HEALTHY",
          recordId: relationship.id,
          message: "Stale relationship is incorrectly marked Healthy"
        });
      }
    }

    for (const legacyId of comparison.missingEntities) {
      findings.push({
        severity: "CRITICAL",
        code: "LEGACY_ENTITY_UNMAPPED",
        recordId: legacyId,
        message: "Legacy Service is not mapped to a canonical entity"
      });
    }
    for (const legacyId of comparison.missingRelationships) {
      findings.push({
        severity: "CRITICAL",
        code: "LEGACY_RELATIONSHIP_UNMAPPED",
        recordId: legacyId,
        message:
          "Legacy ServiceDependency is not mapped to a canonical relationship"
      });
    }
    for (const mapping of comparison.ambiguousMappings) {
      findings.push({
        severity: "CRITICAL",
        code: "AMBIGUOUS_COMPATIBILITY_MAPPING",
        recordId: mapping.legacyId,
        message: `Ambiguous ${mapping.kind.toLowerCase()} compatibility mapping`
      });
    }
    for (const difference of comparison.healthDifferences) {
      findings.push({
        severity: "WARNING",
        code: "LEGACY_CANONICAL_HEALTH_DIFFERENCE",
        recordId: difference.legacyServiceId,
        message:
          `Legacy=${difference.legacyHealth}, canonical=${difference.canonicalHealth}`
      });
    }

    const [alertsWithoutCanonical, automationStepsWithoutCanonical] =
      await Promise.all([
        prisma.alert.count({
          where: {
            serviceId: { not: null },
            operationalEntityId: null
          }
        }),
        prisma.automationRunStep.count({
          where: {
            targetServiceId: { not: null },
            targetEntityId: null
          }
        })
      ]);
    if (alertsWithoutCanonical > 0) {
      findings.push({
        severity: "CRITICAL",
        code: "ALERT_REFERENCE_UNMIGRATED",
        message: `${alertsWithoutCanonical} legacy alert references have no canonical entity`
      });
    }
    if (automationStepsWithoutCanonical > 0) {
      findings.push({
        severity: "CRITICAL",
        code: "AUTOMATION_REFERENCE_UNMIGRATED",
        message: `${automationStepsWithoutCanonical} automation step references have no canonical entity`
      });
    }

    const critical = findings.filter(
      (finding) => finding.severity === "CRITICAL"
    ).length;
    const warnings = findings.length - critical;
    return {
      generatedAt: now.toISOString(),
      counts: {
        activeEntities: entities.length,
        activeRelationships: relationships.length,
        quarantinedRelationships,
        findings: findings.length,
        critical,
        warnings
      },
      findings,
      comparison,
      passes: critical === 0
    };
  };
