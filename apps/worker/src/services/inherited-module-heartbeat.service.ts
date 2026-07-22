import { ProjectStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";

export const inheritedHeartbeatStatus = (params: {
  heartbeatStatus: string;
  ageMinutes: number;
}): ProjectStatus => {
  if (params.ageMinutes >= 10) return ProjectStatus.DEGRADED;
  if (params.heartbeatStatus === "DOWN") return ProjectStatus.DOWN;
  if (params.heartbeatStatus === "DEGRADED") return ProjectStatus.DEGRADED;
  if (params.heartbeatStatus === "PAUSED") return ProjectStatus.PAUSED;
  return ProjectStatus.HEALTHY;
};

export const runtimeEvidenceIsStale = (ageMinutes: number): boolean => ageMinutes >= 10;

const canonicalHealth = (status: ProjectStatus): string => {
  if (status === ProjectStatus.DOWN) return "DOWN";
  if (status === ProjectStatus.DEGRADED) return "DEGRADED";
  if (status === ProjectStatus.PAUSED) return "PAUSED";
  return "HEALTHY";
};

export const updateInheritedModuleHeartbeatHealth = async (params: {
  projectId: string;
  organizationId: string | null;
  heartbeatStatus: string;
  ageMinutes: number;
  observedAt: Date;
}): Promise<number> => {
  const status = inheritedHeartbeatStatus(params);
  const modules = await prisma.service.findMany({
    where: {
      projectId: params.projectId,
      type: "MODULE",
      OutgoingDependencies: {
        some: {
          dependencyType: "HIERARCHY",
          source: "CONNECTION_DISCOVERY",
          isActive: true
        }
      }
    },
    select: { id: true }
  });
  const moduleIds = modules.map((module) => module.id);
  if (moduleIds.length === 0) return 0;

  await prisma.service.updateMany({
    where: { id: { in: moduleIds } },
    data: { status, updatedAt: new Date() }
  });

  if (params.organizationId) {
    const stale = params.ageMinutes >= 10;
    await prisma.operationalEntity.updateMany({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        legacyServiceId: { in: moduleIds }
      },
      data: {
        health: canonicalHealth(status),
        healthReason: stale
          ? `Inherited application heartbeat is stale (${Math.floor(params.ageMinutes)} minutes)`
          : `Inherited from application heartbeat (${params.heartbeatStatus})`,
        freshUntil: stale ? params.observedAt : new Date(params.observedAt.getTime() + 5 * 60_000),
        staleAt: stale ? new Date() : null,
        lastSignalKind: "APPLICATION_HEARTBEAT",
        updatedAt: new Date()
      }
    });
  }

  return moduleIds.length;
};

/**
 * Runtime component checks are delivered inside the signed application heartbeat.
 * When that stream stops, mark those components and their dependency paths stale
 * rather than leaving old successful evidence green for hours.
 */
export const updateRuntimeEvidenceHeartbeatHealth = async (params: {
  projectId: string;
  organizationId: string | null;
  ageMinutes: number;
  observedAt: Date;
}): Promise<number> => {
  if (!runtimeEvidenceIsStale(params.ageMinutes)) return 0;

  const services = await prisma.service.findMany({
    where: {
      projectId: params.projectId,
      ownerTeam: "Runtime Evidence"
    },
    select: { id: true }
  });
  const serviceIds = services.map((service) => service.id);
  if (serviceIds.length === 0) return 0;

  const now = new Date();
  await prisma.service.updateMany({
    where: { id: { in: serviceIds } },
    data: {
      status: ProjectStatus.DEGRADED,
      updatedAt: now
    }
  });

  if (params.organizationId) {
    const entities = await prisma.operationalEntity.findMany({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        legacyServiceId: { in: serviceIds }
      },
      select: { id: true }
    });
    const entityIds = entities.map((entity) => entity.id);

    if (entityIds.length > 0) {
      await prisma.operationalEntity.updateMany({
        where: { id: { in: entityIds } },
        data: {
          health: "DEGRADED",
          healthReason: `Signed runtime evidence is stale (${Math.floor(params.ageMinutes)} minutes)`,
          freshUntil: params.observedAt,
          staleAt: now,
          discoveryState: "STALE",
          lastSignalKind: "SIGNED_RUNTIME_EVIDENCE",
          updatedAt: now
        }
      });

      await prisma.operationalRelationship.updateMany({
        where: {
          organizationId: params.organizationId,
          projectId: params.projectId,
          lifecycle: "ACTIVE",
          OR: [
            { sourceEntityId: { in: entityIds } },
            { targetEntityId: { in: entityIds } }
          ]
        },
        data: {
          health: "DEGRADED",
          freshUntil: params.observedAt,
          staleAt: now,
          discoveryState: "STALE",
          updatedAt: now
        }
      });
    }
  }

  return serviceIds.length;
};
