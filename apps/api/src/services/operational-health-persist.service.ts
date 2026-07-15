import { prisma } from "../lib/prisma";
import {
  computeOperationalHealthRollup,
  isLearnedTopologyEnabled,
  normalizeImpactRole,
  type OperationalHealthSnapshot
} from "./operational-health-rollup.service";

export { isLearnedTopologyEnabled };

export type GraphHealthQuery = {
  organizationId: string;
  projectId?: string;
  locationId?: string;
};

const loadGraphForRollup = async (query: GraphHealthQuery) => {
  const [organization, entities, relationships] = await Promise.all([
    prisma.organization.findFirst({
      where: { id: query.organizationId },
      select: { topologyMode: true }
    }),
    prisma.operationalEntity.findMany({
      where: {
        organizationId: query.organizationId,
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.locationId ? { operationalLocationId: query.locationId } : {})
      }
    }),
    prisma.operationalRelationship.findMany({
      where: {
        organizationId: query.organizationId,
        ...(query.projectId ? { projectId: query.projectId } : {})
      }
    })
  ]);

  let scopedRelationships = relationships;
  if (query.locationId) {
    const entityIds = new Set(entities.map((entity) => entity.id));
    scopedRelationships = relationships.filter(
      (relationship) => entityIds.has(relationship.sourceEntityId) || entityIds.has(relationship.targetEntityId)
    );
  }

  return {
    topologyMode: organization?.topologyMode ?? "CENTRALISED",
    entities,
    relationships: scopedRelationships
  };
};

export const getOperationalGraphHealth = async (query: GraphHealthQuery): Promise<OperationalHealthSnapshot> => {
  const graph = await loadGraphForRollup(query);
  return computeOperationalHealthRollup({
    entities: graph.entities,
    relationships: graph.relationships,
    topologyMode: graph.topologyMode
  });
};

export const recalculateAndPersistOperationalGraphHealth = async (
  query: GraphHealthQuery
): Promise<OperationalHealthSnapshot> => {
  const snapshot = await getOperationalGraphHealth(query);
  const now = new Date();
  await Promise.all(
    snapshot.entities.map((row) =>
      prisma.operationalEntity.updateMany({
        where: {
          id: row.entityId,
          organizationId: query.organizationId,
          // Do not overwrite an explicit override's stored reason while still recording rolled health.
          ...(row.overrideApplied ? {} : {})
        },
        data: {
          health: row.currentHealth,
          healthReason: row.reason,
          healthConfidence: row.confidence,
          updatedAt: now
        }
      })
    )
  );
  return snapshot;
};

export type ObserveRelationshipInput = {
  organizationId: string;
  relationshipId?: string;
  sourceEntityId?: string;
  targetEntityId?: string;
  relationshipType?: string;
  confidenceBoost?: number;
};

/**
 * Strengthen DISCOVERED/LEARNED relationship evidence. Does not approve PENDING edges.
 * Auto-proposal from bare observation pairs only occurs when the learned topology flag is on.
 */
export const observeOperationalRelationship = async (input: ObserveRelationshipInput) => {
  const existing = input.relationshipId
    ? await prisma.operationalRelationship.findFirst({
        where: { id: input.relationshipId, organizationId: input.organizationId }
      })
    : input.sourceEntityId && input.targetEntityId && input.relationshipType
      ? await prisma.operationalRelationship.findFirst({
          where: {
            organizationId: input.organizationId,
            sourceEntityId: input.sourceEntityId,
            targetEntityId: input.targetEntityId,
            relationshipType: input.relationshipType
          }
        })
      : null;

  if (!existing) {
    if (!isLearnedTopologyEnabled()) {
      return { created: false as const, reason: "learned_topology_disabled" as const, relationship: null };
    }
    if (!input.sourceEntityId || !input.targetEntityId || !input.relationshipType) {
      return { created: false as const, reason: "missing_edge_identity" as const, relationship: null };
    }
    return { created: false as const, reason: "not_found" as const, relationship: null };
  }

  if (existing.provenance !== "DISCOVERED" && existing.provenance !== "LEARNED") {
    return { created: false as const, reason: "provenance_not_observable" as const, relationship: existing };
  }

  const boost = typeof input.confidenceBoost === "number" ? input.confidenceBoost : 0.05;
  const nextConfidence = Math.min(0.99, (existing.confidence ?? 0.5) + boost);
  const relationship = await prisma.operationalRelationship.update({
    where: { id: existing.id },
    data: {
      observationCount: { increment: 1 },
      confidence: nextConfidence,
      lastObservedAt: new Date(),
      updatedAt: new Date()
    }
  });
  return { created: false as const, reason: "observed" as const, relationship };
};

export const proposeImpactRole = (value: unknown): string => normalizeImpactRole(typeof value === "string" ? value : undefined);
