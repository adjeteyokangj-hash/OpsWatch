/**
 * Adaptive operational-graph health roll-up.
 * Only APPROVED + ACTIVE relationships participate. PENDING LEARNED edges are ignored.
 * Learned topology auto-creation is gated by OPSWATCH_LEARNED_TOPOLOGY_ENABLED
 * (and the ai_led_safe operating profile).
 */

import { resolveEffectiveEnvFlag } from "./intelligence/ai-operating-profile.service";

export const ENTITY_HEALTH_VALUES = [
  "HEALTHY",
  "DEGRADED",
  "AT_RISK",
  "DOWN",
  "UNKNOWN",
  "MAINTENANCE",
  "DISABLED"
] as const;

export type EntityHealth = (typeof ENTITY_HEALTH_VALUES)[number];

export const IMPACT_ROLE_VALUES = [
  "REQUIRED",
  "OPTIONAL",
  "REDUNDANT",
  "DEGRADED",
  "BUSINESS_CRITICAL"
] as const;

export type ImpactRole = (typeof IMPACT_ROLE_VALUES)[number];

export type TopologyMode = "CENTRALISED" | "DISTRIBUTED" | "HYBRID";

export type RollupEntityInput = {
  id: string;
  name?: string;
  health: string;
  healthOverride?: string | null;
  healthConfidence?: number | null;
  lastSeenAt?: Date | string | null;
  operationalLocationId?: string | null;
  lifecycle?: string;
  organizationId?: string;
};

export type RollupRelationshipInput = {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: string;
  impactRole?: string | null;
  approvalStatus?: string | null;
  lifecycle?: string | null;
  provenance?: string | null;
  confidence?: number | null;
  lastObservedAt?: Date | string | null;
  criticality?: string | null;
};

export type EntityHealthExplanation = {
  entityId: string;
  currentHealth: EntityHealth;
  reason: string;
  contributingEntityIds: string[];
  dependencyCause: string | null;
  evidenceTimestamp: string | null;
  confidence: number;
  overrideApplied: boolean;
};

export type LocationHealthRollup = {
  locationId: string | null;
  label: string;
  health: EntityHealth;
  reason: string;
  contributingEntityIds: string[];
  entityCount: number;
};

export type OrgHealthRollup = {
  health: EntityHealth;
  topologyMode: TopologyMode;
  reason: string;
  contributingEntityIds: string[];
  confidence: number;
};

export type OperationalHealthSnapshot = {
  entities: EntityHealthExplanation[];
  locations: LocationHealthRollup[];
  organization: OrgHealthRollup;
  calculatedAt: string;
};

const healthSeverity: Record<EntityHealth, number> = {
  DOWN: 60,
  AT_RISK: 50,
  DEGRADED: 40,
  UNKNOWN: 30,
  MAINTENANCE: 20,
  DISABLED: 10,
  HEALTHY: 0
};

export const isLearnedTopologyEnabled = (): boolean =>
  resolveEffectiveEnvFlag("OPSWATCH_LEARNED_TOPOLOGY_ENABLED");

export const normalizeEntityHealth = (value: string | null | undefined): EntityHealth =>
  ENTITY_HEALTH_VALUES.includes(value as EntityHealth) ? (value as EntityHealth) : "UNKNOWN";

export const normalizeImpactRole = (value: string | null | undefined): ImpactRole =>
  IMPACT_ROLE_VALUES.includes(value as ImpactRole) ? (value as ImpactRole) : "REQUIRED";

export const normalizeTopologyMode = (value: string | null | undefined): TopologyMode => {
  if (value === "DISTRIBUTED" || value === "HYBRID") return value;
  return "CENTRALISED";
};

export const isActiveApprovedRelationship = (relationship: RollupRelationshipInput): boolean =>
  (relationship.approvalStatus ?? "APPROVED") === "APPROVED" &&
  (relationship.lifecycle ?? "ACTIVE") === "ACTIVE";

const worseHealth = (a: EntityHealth, b: EntityHealth): EntityHealth =>
  healthSeverity[a] >= healthSeverity[b] ? a : b;

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const escalateFromDependency = (
  impactRole: ImpactRole,
  dependencyHealth: EntityHealth,
  redundantAllDown: boolean
): EntityHealth | null => {
  if (dependencyHealth === "DISABLED" || dependencyHealth === "HEALTHY") return null;
  if (impactRole === "OPTIONAL") {
    if (dependencyHealth === "DOWN" || dependencyHealth === "AT_RISK") return "AT_RISK";
    if (dependencyHealth === "DEGRADED") return "AT_RISK";
    return null;
  }
  if (impactRole === "REDUNDANT") {
    if (!redundantAllDown) return null;
    return dependencyHealth === "DOWN" ? "DEGRADED" : worseHealth("AT_RISK", dependencyHealth);
  }
  if (impactRole === "DEGRADED") {
    if (dependencyHealth === "DOWN" || dependencyHealth === "AT_RISK" || dependencyHealth === "DEGRADED") {
      return "DEGRADED";
    }
    return null;
  }
  if (impactRole === "BUSINESS_CRITICAL") {
    if (dependencyHealth === "DOWN") return "DOWN";
    if (dependencyHealth === "AT_RISK") return "AT_RISK";
    if (dependencyHealth === "DEGRADED") return "DEGRADED";
    return null;
  }
  // REQUIRED
  if (dependencyHealth === "DOWN") return "DEGRADED";
  if (dependencyHealth === "AT_RISK") return "AT_RISK";
  if (dependencyHealth === "DEGRADED") return "DEGRADED";
  return null;
};

const intrinsicHealth = (entity: RollupEntityInput): { health: EntityHealth; overrideApplied: boolean } => {
  if (entity.healthOverride && ENTITY_HEALTH_VALUES.includes(entity.healthOverride as EntityHealth)) {
    return { health: entity.healthOverride as EntityHealth, overrideApplied: true };
  }
  return { health: normalizeEntityHealth(entity.health), overrideApplied: false };
};

const aggregateWorst = (
  healths: EntityHealth[],
  empty: EntityHealth = "UNKNOWN"
): EntityHealth => {
  if (healths.length === 0) return empty;
  return healths.reduce((worst, next) => worseHealth(worst, next), "HEALTHY");
};

/**
 * Pure roll-up: source depends on target. PENDING/REJECTED/IGNORED edges are excluded.
 */
export const computeOperationalHealthRollup = (input: {
  entities: RollupEntityInput[];
  relationships: RollupRelationshipInput[];
  topologyMode?: string | null;
  calculatedAt?: Date;
}): OperationalHealthSnapshot => {
  const calculatedAt = (input.calculatedAt ?? new Date()).toISOString();
  const topologyMode = normalizeTopologyMode(input.topologyMode);
  const activeEntities = input.entities.filter((entity) => (entity.lifecycle ?? "ACTIVE") !== "INACTIVE");
  const entityMap = new Map(activeEntities.map((entity) => [entity.id, entity]));
  const relationships = input.relationships.filter(isActiveApprovedRelationship);

  const intrinsic = new Map<string, { health: EntityHealth; overrideApplied: boolean }>();
  for (const entity of activeEntities) {
    intrinsic.set(entity.id, intrinsicHealth(entity));
  }

  const outgoing = new Map<string, RollupRelationshipInput[]>();
  for (const relationship of relationships) {
    if (!entityMap.has(relationship.sourceEntityId) || !entityMap.has(relationship.targetEntityId)) continue;
    const list = outgoing.get(relationship.sourceEntityId) ?? [];
    list.push(relationship);
    outgoing.set(relationship.sourceEntityId, list);
  }

  const rolled = new Map<string, EntityHealthExplanation>();
  const visiting = new Set<string>();

  const resolveEntity = (entityId: string): EntityHealthExplanation => {
    const cached = rolled.get(entityId);
    if (cached) return cached;
    if (visiting.has(entityId)) {
      const base = intrinsic.get(entityId) ?? { health: "UNKNOWN" as EntityHealth, overrideApplied: false };
      return {
        entityId,
        currentHealth: base.health,
        reason: "Cycle detected; using intrinsic health",
        contributingEntityIds: [],
        dependencyCause: null,
        evidenceTimestamp: null,
        confidence: 0.4,
        overrideApplied: base.overrideApplied
      };
    }
    visiting.add(entityId);

    const entity = entityMap.get(entityId)!;
    const base = intrinsic.get(entityId)!;
    let health = base.health;
    const contributing = new Set<string>();
    let dependencyCause: string | null = null;
    let evidenceTimestamp: string | null = toIso(entity.lastSeenAt);
    let confidence = typeof entity.healthConfidence === "number" ? entity.healthConfidence : 0.7;
    const reasons: string[] = [];

    if (base.overrideApplied) {
      reasons.push(`healthOverride=${base.health}`);
      confidence = Math.max(confidence, 0.95);
    } else {
      const deps = outgoing.get(entityId) ?? [];
      const redundantGroups = new Map<string, RollupRelationshipInput[]>();
      for (const dep of deps) {
        if (normalizeImpactRole(dep.impactRole) !== "REDUNDANT") continue;
        const key = `${dep.relationshipType}`;
        const group = redundantGroups.get(key) ?? [];
        group.push(dep);
        redundantGroups.set(key, group);
      }

      for (const dep of deps) {
        const role = normalizeImpactRole(dep.impactRole);
        const dependency = resolveEntity(dep.targetEntityId);
        const group = role === "REDUNDANT" ? redundantGroups.get(dep.relationshipType) ?? [dep] : [dep];
        const redundantAllDown =
          role !== "REDUNDANT" ||
          group.every((peer) => resolveEntity(peer.targetEntityId).currentHealth === "DOWN");

        const escalation = escalateFromDependency(role, dependency.currentHealth, redundantAllDown);
        if (!escalation) continue;

        const next = worseHealth(health, escalation);
        if (next !== health || contributing.size === 0) {
          health = next;
          contributing.add(dep.targetEntityId);
          for (const peer of dependency.contributingEntityIds) contributing.add(peer);
          dependencyCause = `${role} dependency ${dep.relationshipType} → ${dep.targetEntityId} (${dependency.currentHealth})`;
          reasons.push(dependencyCause);
          evidenceTimestamp = toIso(dep.lastObservedAt) ?? dependency.evidenceTimestamp ?? evidenceTimestamp;
          confidence = Math.min(
            0.99,
            Math.max(confidence * 0.9, typeof dep.confidence === "number" ? dep.confidence : 0.65)
          );
        }
      }
    }

    visiting.delete(entityId);
    const explanation: EntityHealthExplanation = {
      entityId,
      currentHealth: health,
      reason:
        reasons.length > 0
          ? reasons.join("; ")
          : base.overrideApplied
            ? `Override ${base.health}`
            : `Intrinsic ${base.health}`,
      contributingEntityIds: [...contributing],
      dependencyCause,
      evidenceTimestamp,
      confidence: Number(confidence.toFixed(3)),
      overrideApplied: base.overrideApplied
    };
    rolled.set(entityId, explanation);
    return explanation;
  };

  for (const entity of activeEntities) {
    resolveEntity(entity.id);
  }

  const entityExplanations = activeEntities.map((entity) => rolled.get(entity.id)!);

  const byLocation = new Map<string | null, EntityHealthExplanation[]>();
  for (const entity of activeEntities) {
    const key = entity.operationalLocationId ?? null;
    const list = byLocation.get(key) ?? [];
    list.push(rolled.get(entity.id)!);
    byLocation.set(key, list);
  }

  const locations: LocationHealthRollup[] = [...byLocation.entries()].map(([locationId, rows]) => {
    const health = aggregateWorst(rows.map((row) => row.currentHealth));
    const contributors = rows
      .filter((row) => healthSeverity[row.currentHealth] >= healthSeverity[health] && row.currentHealth !== "HEALTHY")
      .map((row) => row.entityId);
    return {
      locationId,
      label: locationId ? `location:${locationId}` : "unbound/central",
      health,
      reason:
        rows.length === 0
          ? "No entities at location"
          : contributors.length > 0
            ? `Worst entity health among ${rows.length} bound entities`
            : `All ${rows.length} entities healthy or non-critical`,
      contributingEntityIds: contributors.length > 0 ? contributors : rows.map((row) => row.entityId),
      entityCount: rows.length
    };
  });

  const unbound = locations.find((row) => row.locationId === null);
  const boundLocations = locations.filter((row) => row.locationId !== null);

  let orgHealth: EntityHealth = "UNKNOWN";
  let orgReason = "";
  let orgContributors: string[] = [];

  if (topologyMode === "DISTRIBUTED") {
    const inputs = boundLocations.length > 0 ? boundLocations : locations;
    orgHealth = aggregateWorst(inputs.map((row) => row.health));
    orgContributors = inputs.flatMap((row) => row.contributingEntityIds);
    orgReason =
      boundLocations.length > 0
        ? "DISTRIBUTED org roll-up from location health"
        : "DISTRIBUTED mode with no bound locations; falling back to available entity groups";
    if (unbound && unbound.entityCount > 0 && unbound.health !== "HEALTHY" && unbound.health !== "UNKNOWN") {
      orgReason += `; unbound/central entities reported ${unbound.health}`;
    }
  } else if (topologyMode === "HYBRID") {
    const inputs = [
      ...(unbound ? [unbound] : []),
      ...boundLocations
    ];
    orgHealth = aggregateWorst(inputs.map((row) => row.health), entityExplanations.length ? "HEALTHY" : "UNKNOWN");
    orgContributors = inputs.flatMap((row) => row.contributingEntityIds);
    orgReason = "HYBRID org roll-up from unbound/central entities and location health";
  } else {
    orgHealth = aggregateWorst(entityExplanations.map((row) => row.currentHealth));
    orgContributors = entityExplanations
      .filter((row) => row.currentHealth === orgHealth && orgHealth !== "HEALTHY")
      .map((row) => row.entityId);
    orgReason = "CENTRALISED org roll-up from all operational entities";
  }

  const confidence =
    entityExplanations.length === 0
      ? 0
      : Number(
          (
            entityExplanations.reduce((sum, row) => sum + row.confidence, 0) / entityExplanations.length
          ).toFixed(3)
        );

  return {
    entities: entityExplanations,
    locations,
    organization: {
      health: orgHealth,
      topologyMode,
      reason: orgReason,
      contributingEntityIds: [...new Set(orgContributors)],
      confidence
    },
    calculatedAt
  };
};
