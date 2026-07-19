import { canonicalGraph } from "../canonical-graph.service";
import { prisma } from "../../lib/prisma";
import { otelInstanceCardinalityCap } from "./otel-feature-flags";
import type { NormalizedSignalDraft } from "./otel-normalize";

export type ResolvedOtelEntity = {
  id: string;
  entityType: string;
  name: string;
  legacyServiceId: string | null;
  created: boolean;
};

const entityFreshMs = (): number =>
  Number(process.env.OPSWATCH_OTEL_ENTITY_FRESH_MS ?? 30 * 60_000);

const freshUntilFor = (draft: NormalizedSignalDraft): Date =>
  draft.freshUntil ??
  new Date(draft.observedAt.getTime() + entityFreshMs());

const healthFromDraft = (draft: NormalizedSignalDraft): string =>
  draft.healthImpact === "CRITICAL"
    ? "CRITICAL"
    : draft.healthImpact === "DEGRADED"
      ? "DEGRADED"
      : draft.healthImpact === "HEALTHY"
        ? "HEALTHY"
        : "UNKNOWN";

const mapEntityType = (
  draft: NormalizedSignalDraft,
  role: "service" | "instance" | "dependency"
): string => {
  if (role === "instance") {
    return draft.resourceAttributes["container.id"] ? "CONTAINER" : "HOST";
  }
  if (role === "dependency") {
    if (typeof draft.attributes["db.system"] === "string") return "DATABASE";
    if (typeof draft.attributes["messaging.system"] === "string") return "QUEUE";
    return "EXTERNAL_API";
  }
  return "SERVICE";
};

const serviceSourceKey = (draft: NormalizedSignalDraft): string => {
  const namespace =
    typeof draft.resourceAttributes["service.namespace"] === "string"
      ? draft.resourceAttributes["service.namespace"]
      : "default";
  return `${namespace}:${draft.serviceName}`;
};

const instanceSourceKey = (draft: NormalizedSignalDraft): string => {
  const host =
    draft.resourceAttributes["host.id"] ??
    draft.resourceAttributes["host.name"];
  const container = draft.resourceAttributes["container.id"];
  return [serviceSourceKey(draft), host, container]
    .filter(Boolean)
    .join(":");
};

const findLegacyCompatibility = async (input: {
  organizationId: string;
  projectId: string | null;
  environment: string;
  serviceName: string;
}): Promise<{ serviceId: string | null; entityId: string | null }> => {
  if (!input.projectId) return { serviceId: null, entityId: null };
  const service = await prisma.service.findFirst({
    where: { projectId: input.projectId, name: input.serviceName },
    select: { id: true }
  });
  if (!service) return { serviceId: null, entityId: null };
  const entityId = await canonicalGraph.resolveLegacyService({
    organizationId: input.organizationId,
    projectId: input.projectId,
    environment: input.environment,
    legacyServiceId: service.id
  });
  return { serviceId: service.id, entityId };
};

const resultFor = (
  entity: { id: string; entityType: string; name: string },
  legacyServiceId: string | null
): ResolvedOtelEntity => ({
  id: entity.id,
  entityType: entity.entityType,
  name: entity.name,
  legacyServiceId,
  created: false
});

export const resolveOtelServiceEntity = async (input: {
  organizationId: string;
  projectId: string | null;
  draft: NormalizedSignalDraft;
}): Promise<ResolvedOtelEntity> => {
  const compatibility = await findLegacyCompatibility({
    organizationId: input.organizationId,
    projectId: input.projectId,
    environment: input.draft.environment,
    serviceName: input.draft.serviceName
  });
  const entity = await canonicalGraph.upsertEntity({
    organizationId: input.organizationId,
    projectId: input.projectId,
    environment: input.draft.environment,
    entityType: "SERVICE",
    stableKey: serviceSourceKey(input.draft),
    name: input.draft.serviceName,
    source: "OTEL_BRIDGE",
    sourceKey: serviceSourceKey(input.draft),
    provenance: "OTEL_COLLECTOR",
    health: healthFromDraft(input.draft),
    healthReason: `${input.draft.signalType}:${input.draft.fingerprint}`,
    observedAt: input.draft.observedAt,
    freshUntil: freshUntilFor(input.draft),
    confirmationState: "CONFIRMED",
    confidence: 0.9,
    metadata: {
      resourceAttributes: input.draft.resourceAttributes
    },
    compatibilityEntityId: compatibility.entityId ?? undefined
  });
  if (compatibility.serviceId && input.projectId) {
    await canonicalGraph.mapLegacyService({
      organizationId: input.organizationId,
      projectId: input.projectId,
      environment: input.draft.environment,
      legacyServiceId: compatibility.serviceId,
      entityId: entity.id
    });
  }
  return resultFor(entity, compatibility.serviceId);
};

export const resolveOtelInstanceEntity = async (input: {
  organizationId: string;
  projectId: string | null;
  draft: NormalizedSignalDraft;
  parentServiceId: string;
}): Promise<ResolvedOtelEntity | null> => {
  const host =
    input.draft.resourceAttributes["host.id"] ??
    input.draft.resourceAttributes["host.name"];
  const container = input.draft.resourceAttributes["container.id"];
  if (!host && !container) return null;

  const sourceKey = instanceSourceKey(input.draft);
  const existingIdentity = await prisma.operationalEntityIdentity.findUnique({
    where: {
      organizationId_projectScopeKey_environment_source_sourceKey: {
        organizationId: input.organizationId,
        projectScopeKey: input.projectId ?? "",
        environment: input.draft.environment.toLowerCase(),
        source: "OTEL_BRIDGE",
        sourceKey: sourceKey.toLowerCase()
      }
    },
    select: { entityId: true }
  });
  if (!existingIdentity) {
    const count = await prisma.operationalEntity.count({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        environment: input.draft.environment.toLowerCase(),
        entityType: { in: ["HOST", "CONTAINER"] },
        metadataJson: {
          path: ["parentServiceId"],
          equals: input.parentServiceId
        }
      }
    });
    if (count >= otelInstanceCardinalityCap()) return null;
  }

  const name =
    (typeof container === "string" && container) ||
    (typeof host === "string" && host) ||
    `${input.draft.serviceName}-instance`;
  const entity = await canonicalGraph.upsertEntity({
    organizationId: input.organizationId,
    projectId: input.projectId,
    environment: input.draft.environment,
    entityType: mapEntityType(input.draft, "instance"),
    stableKey: sourceKey,
    name,
    source: "OTEL_BRIDGE",
    sourceKey,
    provenance: "OTEL_COLLECTOR",
    health: healthFromDraft(input.draft),
    observedAt: input.draft.observedAt,
    freshUntil: freshUntilFor(input.draft),
    confirmationState: "CONFIRMED",
    metadata: {
      parentServiceId: input.parentServiceId,
      resourceAttributes: input.draft.resourceAttributes
    }
  });
  return resultFor(entity, null);
};

export const resolveOtelDependencyEntity = async (input: {
  organizationId: string;
  projectId: string | null;
  draft: NormalizedSignalDraft;
}): Promise<ResolvedOtelEntity | null> => {
  const peer =
    (typeof input.draft.attributes["peer.service"] === "string" &&
      input.draft.attributes["peer.service"]) ||
    (typeof input.draft.attributes["server.address"] === "string" &&
      input.draft.attributes["server.address"]) ||
    (typeof input.draft.attributes["db.name"] === "string" &&
      `${input.draft.attributes["db.system"] ?? "db"}:${input.draft.attributes["db.name"]}`) ||
    (typeof input.draft.attributes["messaging.destination.name"] === "string" &&
      `${input.draft.attributes["messaging.system"] ?? "queue"}:${input.draft.attributes["messaging.destination.name"]}`);
  if (!peer || typeof peer !== "string") return null;

  const compatibility = await findLegacyCompatibility({
    organizationId: input.organizationId,
    projectId: input.projectId,
    environment: input.draft.environment,
    serviceName: peer
  });
  const entityType = mapEntityType(input.draft, "dependency");
  const sourceKey = `${entityType}:${peer}`;
  const entity = await canonicalGraph.upsertEntity({
    organizationId: input.organizationId,
    projectId: input.projectId,
    environment: input.draft.environment,
    entityType,
    stableKey: sourceKey,
    name: peer,
    source: "OTEL_BRIDGE",
    sourceKey,
    provenance: "OTEL_COLLECTOR",
    health: healthFromDraft(input.draft),
    observedAt: input.draft.observedAt,
    freshUntil: freshUntilFor(input.draft),
    confirmationState: "CONFIRMED",
    metadata: { attributes: input.draft.attributes },
    compatibilityEntityId: compatibility.entityId ?? undefined
  });
  if (compatibility.serviceId && input.projectId) {
    await canonicalGraph.mapLegacyService({
      organizationId: input.organizationId,
      projectId: input.projectId,
      environment: input.draft.environment,
      legacyServiceId: compatibility.serviceId,
      entityId: entity.id
    });
  }
  return resultFor(entity, compatibility.serviceId);
};
