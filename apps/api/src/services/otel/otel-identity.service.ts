import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
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

const mapEntityType = (draft: NormalizedSignalDraft, role: "service" | "instance" | "dependency") => {
  if (role === "instance") return "HOST";
  if (role === "dependency") {
    const db = draft.attributes["db.system"];
    if (typeof db === "string") return "DATABASE";
    const messaging = draft.attributes["messaging.system"];
    if (typeof messaging === "string") return "QUEUE";
    return "EXTERNAL_API";
  }
  return "SERVICE";
};

const serviceExternalId = (serviceName: string, environment: string) =>
  `otel:${serviceName}:${environment}`;

const instanceExternalId = (draft: NormalizedSignalDraft) => {
  const host = draft.resourceAttributes["host.name"] ?? draft.resourceAttributes["host.id"];
  const container = draft.resourceAttributes["container.id"];
  const key = [host, container].filter(Boolean).join(":") || draft.resourceIdentity;
  return `otel-instance:${draft.serviceName}:${draft.environment}:${key}`;
};

export const resolveOtelServiceEntity = async (input: {
  organizationId: string;
  projectId: string | null;
  draft: NormalizedSignalDraft;
}): Promise<ResolvedOtelEntity> => {
  const { organizationId, projectId, draft } = input;
  const externalId = serviceExternalId(draft.serviceName, draft.environment);
  const now = new Date();
  const freshUntil = new Date(now.getTime() + entityFreshMs());

  const legacyService = projectId
    ? await prisma.service.findFirst({
        where: { projectId, name: draft.serviceName },
        select: { id: true }
      })
    : null;

  const existing = await prisma.operationalEntity.findUnique({
    where: {
      organizationId_entityType_externalId: {
        organizationId,
        entityType: "SERVICE",
        externalId
      }
    }
  });

  if (existing) {
    const preserveName =
      existing.provenance === "DECLARED" || existing.provenance === "MANUAL";
    const updated = await prisma.operationalEntity.update({
      where: { id: existing.id },
      data: {
        projectId,
        legacyServiceId: existing.legacyServiceId ?? legacyService?.id ?? null,
        ...(preserveName ? {} : { name: draft.serviceName }),
        discoverySource: "OTEL_BRIDGE",
        lastSeenAt: draft.observedAt,
        firstSeenAt: existing.firstSeenAt ?? existing.discoveredAt ?? draft.observedAt,
        freshUntil,
        staleAt: null,
        inactiveAt: null,
        signalCount: { increment: 1 },
        lastSignalKind: draft.signalType,
        discoveryState: "ACTIVE",
        lifecycle: "ACTIVE",
        metadataJson: {
          ...(asRecord(existing.metadataJson) ?? {}),
          resourceAttributes: draft.resourceAttributes
        } as Prisma.InputJsonValue,
        updatedAt: now
      }
    });
    return {
      id: updated.id,
      entityType: updated.entityType,
      name: updated.name,
      legacyServiceId: updated.legacyServiceId,
      created: false
    };
  }

  const created = await prisma.operationalEntity.create({
    data: {
      id: randomUUID(),
      organizationId,
      projectId,
      legacyServiceId: legacyService?.id ?? null,
      entityType: "SERVICE",
      name: draft.serviceName,
      externalId,
      provenance: "OTEL_COLLECTOR",
      discoverySource: "OTEL_BRIDGE",
      discoveredAt: draft.observedAt,
      firstSeenAt: draft.observedAt,
      lastSeenAt: draft.observedAt,
      freshUntil,
      signalCount: 1,
      lastSignalKind: draft.signalType,
      discoveryState: "ACTIVE",
      metadataJson: {
        resourceAttributes: draft.resourceAttributes
      } as Prisma.InputJsonValue,
      updatedAt: now
    }
  });

  return {
    id: created.id,
    entityType: created.entityType,
    name: created.name,
    legacyServiceId: created.legacyServiceId,
    created: true
  };
};

export const resolveOtelInstanceEntity = async (input: {
  organizationId: string;
  projectId: string | null;
  draft: NormalizedSignalDraft;
  parentServiceId: string;
}): Promise<ResolvedOtelEntity | null> => {
  const host = input.draft.resourceAttributes["host.name"] ?? input.draft.resourceAttributes["host.id"];
  const container = input.draft.resourceAttributes["container.id"];
  if (!host && !container) return null;

  const cap = otelInstanceCardinalityCap();
  const existingCount = await prisma.operationalEntity.count({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      entityType: { in: ["HOST", "CONTAINER"] },
      metadataJson: {
        path: ["parentServiceId"],
        equals: input.parentServiceId
      }
    }
  });

  const externalId = instanceExternalId(input.draft);
  const existing = await prisma.operationalEntity.findUnique({
    where: {
      organizationId_entityType_externalId: {
        organizationId: input.organizationId,
        entityType: mapEntityType(input.draft, "instance"),
        externalId
      }
    }
  });
  if (!existing && existingCount >= cap) return null;

  const now = new Date();
  const freshUntil = new Date(now.getTime() + entityFreshMs());
  const name =
    (typeof host === "string" && host) ||
    (typeof container === "string" && container) ||
    `${input.draft.serviceName}-instance`;

  if (existing) {
    const updated = await prisma.operationalEntity.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: input.draft.observedAt,
        freshUntil,
        staleAt: null,
        inactiveAt: null,
        signalCount: { increment: 1 },
        lastSignalKind: input.draft.signalType,
        discoveryState: "ACTIVE",
        updatedAt: now
      }
    });
    return {
      id: updated.id,
      entityType: updated.entityType,
      name: updated.name,
      legacyServiceId: updated.legacyServiceId,
      created: false
    };
  }

  const created = await prisma.operationalEntity.create({
    data: {
      id: randomUUID(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      entityType: mapEntityType(input.draft, "instance"),
      name,
      externalId,
      provenance: "OTEL_COLLECTOR",
      discoverySource: "OTEL_BRIDGE",
      discoveredAt: input.draft.observedAt,
      firstSeenAt: input.draft.observedAt,
      lastSeenAt: input.draft.observedAt,
      freshUntil,
      signalCount: 1,
      lastSignalKind: input.draft.signalType,
      discoveryState: "ACTIVE",
      metadataJson: {
        parentServiceId: input.parentServiceId,
        resourceAttributes: input.draft.resourceAttributes
      } as Prisma.InputJsonValue,
      updatedAt: now
    }
  });

  return {
    id: created.id,
    entityType: created.entityType,
    name: created.name,
    legacyServiceId: created.legacyServiceId,
    created: true
  };
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

  const entityType = mapEntityType(input.draft, "dependency");
  const externalId = `otel-dep:${entityType}:${input.draft.environment}:${peer}`;
  const now = new Date();
  const freshUntil = new Date(now.getTime() + entityFreshMs());

  const legacyService = input.projectId
    ? await prisma.service.findFirst({
        where: { projectId: input.projectId, name: peer },
        select: { id: true }
      })
    : null;

  const existing = await prisma.operationalEntity.findUnique({
    where: {
      organizationId_entityType_externalId: {
        organizationId: input.organizationId,
        entityType,
        externalId
      }
    }
  });

  if (existing) {
    const updated = await prisma.operationalEntity.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: input.draft.observedAt,
        freshUntil,
        staleAt: null,
        inactiveAt: null,
        signalCount: { increment: 1 },
        lastSignalKind: input.draft.signalType,
        discoveryState: "ACTIVE",
        legacyServiceId: existing.legacyServiceId ?? legacyService?.id ?? null,
        updatedAt: now
      }
    });
    return {
      id: updated.id,
      entityType: updated.entityType,
      name: updated.name,
      legacyServiceId: updated.legacyServiceId,
      created: false
    };
  }

  const created = await prisma.operationalEntity.create({
    data: {
      id: randomUUID(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      legacyServiceId: legacyService?.id ?? null,
      entityType,
      name: peer,
      externalId,
      provenance: "OTEL_COLLECTOR",
      discoverySource: "OTEL_BRIDGE",
      discoveredAt: input.draft.observedAt,
      firstSeenAt: input.draft.observedAt,
      lastSeenAt: input.draft.observedAt,
      freshUntil,
      signalCount: 1,
      lastSignalKind: input.draft.signalType,
      discoveryState: "ACTIVE",
      metadataJson: {
        attributes: input.draft.attributes
      } as Prisma.InputJsonValue,
      updatedAt: now
    }
  });

  return {
    id: created.id,
    entityType: created.entityType,
    name: created.name,
    legacyServiceId: created.legacyServiceId,
    created: true
  };
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
