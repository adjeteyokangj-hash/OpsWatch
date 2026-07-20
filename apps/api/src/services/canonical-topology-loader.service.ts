import type { ServiceType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type {
  ProjectTopologyResponse,
  TopologyHealthStatus,
  TopologyNodeType
} from "../types/dto";
import { loadRecentCheckResultsByCheckIds } from "./check-result-batch.service";
import {
  buildProjectTopologyResponse,
  type TopologyServiceRecord
} from "./topology.service";
import { worstHealth } from "./service-health.service";

const unresolvedIncidentStatuses = [
  "OPEN",
  "INVESTIGATING",
  "MONITORING"
] as const;
/** Include in-flight recovery statuses so nodes stay non-HEALTHY while verification runs. */
const openAlertStatuses = [
  "OPEN",
  "ACKNOWLEDGED",
  "REMEDIATING",
  "VERIFYING",
  "RECOVERING"
] as const;

const nodeTypeFor = (entityType: string): TopologyNodeType =>
  entityType === "APP" ||
  entityType === "MODULE" ||
  entityType === "WORKFLOW" ||
  entityType === "COMPONENT"
    ? entityType
    : "COMPONENT";

const topologyHealthFor = (health: string): TopologyHealthStatus =>
  health === "CRITICAL" || health === "DOWN"
    ? "CRITICAL"
    : health === "DEGRADED" || health === "AT_RISK"
      ? "DEGRADED"
      : health === "HEALTHY"
        ? "HEALTHY"
        : "UNKNOWN";


/** Map CONTAINS / PROJECT endpoints onto visible APP hierarchy edges. */
const topologyDependencyTypeFor = (relationshipType: string): string => {
  const normalized = relationshipType.trim().toUpperCase();
  if (normalized === "CONTAINS" || normalized === "HIERARCHY") return "HIERARCHY";
  if (normalized === "RUNTIME" || normalized === "DEPENDENCY" || normalized === "DEPENDS_ON") {
    return "DEPENDENCY";
  }
  return normalized;
};

const resolveTopologyEndpointId = (
  entityId: string,
  entityById: Map<string, { entityType: string }>,
  appEntityId: string | null
): string | null => {
  const entity = entityById.get(entityId);
  if (!entity) return null;
  if (entity.entityType === "PROJECT") return appEntityId;
  return entityId;
};

const freshnessFor = (entity: {
  discoveryState: string;
  freshUntil: Date | null;
}): "FRESH" | "STALE" | "INACTIVE" | "UNKNOWN" =>
  entity.discoveryState === "INACTIVE"
    ? "INACTIVE"
    : entity.discoveryState === "STALE" ||
        (entity.freshUntil && entity.freshUntil.getTime() < Date.now())
      ? "STALE"
      : entity.freshUntil
        ? "FRESH"
        : "UNKNOWN";

export const loadCanonicalProjectTopology = async (input: {
  organizationId: string;
  project: { id: string; name: string; status: string };
}): Promise<ProjectTopologyResponse> => {
  const { organizationId, project } = input;
  const [
    entities,
    relationships,
    mappings,
    alerts,
    incidents,
    sloDefinitions,
    heartbeats,
    freshSignals
  ] = await Promise.all([
    prisma.operationalEntity.findMany({
      where: {
        organizationId,
        projectId: project.id,
        lifecycle: "ACTIVE"
      },
      include: {
        OperationalLocation: {
          select: { id: true, name: true, type: true }
        }
      },
      orderBy: [{ entityType: "asc" }, { name: "asc" }]
    }),
    prisma.operationalRelationship.findMany({
      where: {
        organizationId,
        projectId: project.id,
        lifecycle: "ACTIVE",
        OR: [
          { approvalStatus: "APPROVED" },
          { provenance: { not: "LEARNED" } }
        ]
      },
      orderBy: { createdAt: "asc" }
    }),
    prisma.legacyServiceEntityMapping.findMany({
      where: {
        organizationId,
        projectId: project.id,
        status: "ACTIVE"
      },
      select: {
        legacyServiceId: true,
        entityId: true,
        LegacyService: {
          select: {
            Check: { select: { id: true, isActive: true } }
          }
        }
      }
    }),
    prisma.alert.findMany({
      where: { projectId: project.id, status: { in: [...openAlertStatuses] } },
      select: {
        id: true,
        title: true,
        severity: true,
        status: true,
        serviceId: true,
        operationalEntityId: true
      }
    }),
    prisma.incident.findMany({
      where: {
        projectId: project.id,
        status: { in: [...unresolvedIncidentStatuses] }
      },
      select: {
        id: true,
        title: true,
        severity: true,
        status: true,
        IncidentAlert: {
          select: {
            Alert: {
              select: { serviceId: true, operationalEntityId: true }
            }
          }
        }
      }
    }),
    prisma.sLODefinition.findMany({
      where: { projectId: project.id, enabled: true, archivedAt: null },
      select: {
        id: true,
        serviceId: true,
        SLOWindow: {
          orderBy: { windowEnd: "desc" },
          take: 1,
          select: {
            status: true,
            availabilityPct: true,
            errorRatePct: true,
            p95LatencyMs: true,
            burnRate: true
          }
        }
      }
    }),
    prisma.heartbeat.findMany({
      where: { projectId: project.id },
      orderBy: { receivedAt: "desc" },
      take: 12,
      select: { status: true, receivedAt: true }
    }),
    prisma.normalizedOperationalSignal.count({
      where: {
        organizationId,
        projectId: project.id,
        freshUntil: { gt: new Date() }
      }
    })
  ]);

  const mappingByLegacy = new Map(
    mappings.map((mapping) => [mapping.legacyServiceId, mapping.entityId])
  );
  const incidentTopologyReferences =
    incidents.length > 0
      ? await prisma.incidentTopologyReference.findMany({
          where: { incidentId: { in: incidents.map((incident) => incident.id) } },
          select: { incidentId: true, entityId: true }
        })
      : [];
  const incidentEntityIds = new Map<string, string[]>();
  for (const reference of incidentTopologyReferences) {
    if (!reference.entityId) continue;
    incidentEntityIds.set(reference.incidentId, [
      ...(incidentEntityIds.get(reference.incidentId) ?? []),
      reference.entityId
    ]);
  }
  const mappingsByEntity = new Map<
    string,
    (typeof mappings)[number][]
  >();
  for (const mapping of mappings) {
    mappingsByEntity.set(mapping.entityId, [
      ...(mappingsByEntity.get(mapping.entityId) ?? []),
      mapping
    ]);
  }
  const checkIds = mappings.flatMap((mapping) =>
    mapping.LegacyService.Check.map((check) => check.id)
  );
  const checkResults = await loadRecentCheckResultsByCheckIds(checkIds, 12);

  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const appEntityId =
    entities.find((entity) => entity.lifecycle === "ACTIVE" && entity.entityType === "APP")?.id ??
    null;
  const nodeEntities = entities.filter(
    (entity) => entity.lifecycle === "ACTIVE" && entity.entityType !== "PROJECT"
  );

  const services: TopologyServiceRecord[] = nodeEntities.map((entity) => ({
    id: entity.id,
    name: entity.name,
    type: nodeTypeFor(entity.entityType) as ServiceType,
    status: entity.health,
    Check: (mappingsByEntity.get(entity.id) ?? []).flatMap((mapping) =>
      mapping.LegacyService.Check.map((check) => ({
        isActive: check.isActive,
        CheckResult: (checkResults.get(check.id) ?? []).map((result) => ({
          status: result.status,
          checkedAt: result.checkedAt,
          responseTimeMs: result.responseTimeMs
        }))
      }))
    )
  }));

  const entityIds = new Set(nodeEntities.map((entity) => entity.id));
  const visibleRelationships = relationships.flatMap((relationship) => {
    const sourceId = resolveTopologyEndpointId(
      relationship.sourceEntityId,
      entityById,
      appEntityId
    );
    const targetId = resolveTopologyEndpointId(
      relationship.targetEntityId,
      entityById,
      appEntityId
    );
    if (!sourceId || !targetId || sourceId === targetId) return [];
    if (!entityIds.has(sourceId) || !entityIds.has(targetId)) return [];

    const dependencyType = topologyDependencyTypeFor(relationship.relationshipType);
    // CONTAINS is stored parent→child; topology HIERARCHY edges are child→parent.
    const isContains = relationship.relationshipType.trim().toUpperCase() === "CONTAINS";
    const fromServiceId = isContains ? targetId : sourceId;
    const toServiceId = isContains ? sourceId : targetId;

    return [
      {
        ...relationship,
        sourceEntityId: fromServiceId,
        targetEntityId: toServiceId,
        relationshipType: dependencyType
      }
    ];
  });

  let legacyFallbackCount = 0;
  let unresolvedCanonicalReferences = 0;
  const resolveAlertEntity = (alert: {
    operationalEntityId: string | null;
    serviceId: string | null;
  }): string | null => {
    if (alert.operationalEntityId) return alert.operationalEntityId;
    if (alert.serviceId) {
      const mapped = mappingByLegacy.get(alert.serviceId);
      if (mapped) {
        legacyFallbackCount += 1;
        return mapped;
      }
      unresolvedCanonicalReferences += 1;
    }
    return null;
  };

  const topology = buildProjectTopologyResponse({
    project,
    services,
    dependencies: visibleRelationships.map((relationship) => ({
      id: relationship.id,
      fromServiceId: relationship.sourceEntityId,
      toServiceId: relationship.targetEntityId,
      dependencyType: relationship.relationshipType,
      criticality: relationship.criticality,
      isActive: relationship.lifecycle === "ACTIVE"
    })),
    alerts: alerts.map((alert) => ({
      ...alert,
      serviceId: resolveAlertEntity(alert)
    })),
    incidents: incidents.map((incident) => ({
      id: incident.id,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      serviceIds: Array.from(
        new Set([
          ...incident.IncidentAlert.flatMap((reference) => {
            const resolved = resolveAlertEntity(reference.Alert);
            return resolved ? [resolved] : [];
          }),
          ...(incidentEntityIds.get(incident.id) ?? [])
        ])
      )
    })),
    slos: sloDefinitions.map((definition) => {
      let serviceId: string | null = null;
      if (definition.serviceId) {
        const mapped = mappingByLegacy.get(definition.serviceId);
        if (mapped) {
          serviceId = mapped;
          legacyFallbackCount += 1;
        } else {
          unresolvedCanonicalReferences += 1;
        }
      }
      return {
        serviceId,
        latestWindow: definition.SLOWindow[0] ?? null
      };
    }),
    heartbeats
  });

  for (const node of topology.nodes) {
    const entity = entityById.get(node.id);
    if (!entity) continue;
    // Never let stored entity.health paint HEALTHY over live open-alert / check evidence.
    node.status = worstHealth([node.status, topologyHealthFor(entity.health)]);
    topology.nodeContext[node.id] = {
      ...topology.nodeContext[node.id]!,
      canonical: {
        environment: entity.environment,
        entityType: entity.entityType,
        provenance: entity.provenance,
        discoverySource: entity.discoverySource,
        discoveryState: entity.discoveryState,
        freshness: freshnessFor(entity),
        confidence: entity.healthConfidence,
        confirmationState: entity.confirmationState,
        sharedScope: entity.sharedScope,
        isTestSeed: entity.isTestSeed,
        legacyServiceId: entity.legacyServiceId,
        location: entity.OperationalLocation
      },
      otel:
        entity.discoverySource === "OTEL_BRIDGE"
          ? {
              connected: true,
              discoveryState: entity.discoveryState,
              health: entity.health,
              confidence: entity.healthConfidence,
              freshness: freshnessFor(entity),
              signalCount: entity.signalCount,
              lastSeenAt: entity.lastSeenAt?.toISOString() ?? null,
              source: entity.provenance
            }
          : undefined
    };
  }

  const relationshipById = new Map(
    visibleRelationships.map((relationship) => [relationship.id, relationship])
  );
  for (const edge of topology.edges) {
    const relationship = relationshipById.get(edge.id);
    if (!relationship) continue;
    edge.status = worstHealth([edge.status, topologyHealthFor(relationship.health)]);
    edge.provenance = relationship.provenance;
    edge.confidence = relationship.confidence;
    edge.discoveryState = relationship.discoveryState;
    edge.freshness = freshnessFor(relationship);
    edge.confirmationState = relationship.confirmationState;
    if (relationship.provenance === "OTEL_COLLECTOR") {
      edge.otel = {
        source: relationship.provenance,
        health: relationship.health,
        discoveryState: relationship.discoveryState
      };
    }
  }

  topology.summary.healthy = topology.nodes.filter(
    (node) => node.status === "HEALTHY"
  ).length;
  topology.summary.degraded = topology.nodes.filter(
    (node) => node.status === "DEGRADED"
  ).length;
  topology.summary.critical = topology.nodes.filter(
    (node) => node.status === "CRITICAL"
  ).length;
  topology.summary.unknown = topology.nodes.filter(
    (node) => node.status === "UNKNOWN"
  ).length;
  topology.otelOverlay = {
    enabled:
      entities.some((entity) => entity.discoverySource === "OTEL_BRIDGE") ||
      freshSignals > 0,
    entities: entities.filter(
      (entity) => entity.discoverySource === "OTEL_BRIDGE"
    ).length,
    relationships: relationships.filter(
      (relationship) => relationship.provenance === "OTEL_COLLECTOR"
    ).length,
    freshSignals,
    staleEntities: entities.filter(
      (entity) =>
        entity.discoverySource === "OTEL_BRIDGE" &&
        entity.discoveryState === "STALE"
    ).length
  };
  if (process.env.NODE_ENV !== "production") {
    topology.readerDiagnostic = {
      reader: "CANONICAL",
      fallbackUsed: false,
      canonicalEntityCount: entities.length,
      canonicalRelationshipCount: visibleRelationships.length,
      legacyFallbackCount,
      unresolvedCanonicalReferences,
      details:
        legacyFallbackCount > 0
          ? [
              `${legacyFallbackCount} reference(s) resolved via legacy service->entity mapping (expected compatibility path)`
            ]
          : []
    };
  }
  return topology;
};
