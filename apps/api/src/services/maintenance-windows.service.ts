import { randomUUID } from "crypto";
import type { MaintenanceWindowStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";

export type MaintenanceRemediationPolicyOption =
  | "DERIVED"
  | "ALLOW_LOW_RISK"
  | "REQUIRE_APPROVAL"
  | "SUPPRESS"
  | "DEFER"
  | "EMERGENCY_ONLY";

const REMEDIATION_POLICY_OPTIONS = new Set<string>([
  "ALLOW_LOW_RISK",
  "REQUIRE_APPROVAL",
  "SUPPRESS",
  "DEFER",
  "EMERGENCY_ONLY"
]);

export const normalizeRemediationPolicy = (
  value: unknown
): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === "" || value === "DERIVED") return null;
  const normalized = String(value).trim().toUpperCase();
  if (!REMEDIATION_POLICY_OPTIONS.has(normalized)) {
    throw new Error(
      "remediationPolicy must be DERIVED, ALLOW_LOW_RISK, REQUIRE_APPROVAL, SUPPRESS, DEFER, or EMERGENCY_ONLY"
    );
  }
  return normalized;
};

export type MaintenanceWindowDto = {
  id: string;
  organizationId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  status: MaintenanceWindowStatus;
  suppressAlerts: boolean;
  suppressIncidents: boolean;
  allowAutonomous: boolean;
  remediationPolicy: string | null;
  createdById: string;
  cancelledById: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  serviceIds: string[];
};

const toDto = (row: {
  id: string;
  organizationId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  status: MaintenanceWindowStatus;
  suppressAlerts: boolean;
  suppressIncidents: boolean;
  allowAutonomous: boolean;
  remediationPolicy?: string | null;
  createdById: string;
  cancelledById: string | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  Services: Array<{ serviceId: string }>;
}): MaintenanceWindowDto => ({
  id: row.id,
  organizationId: row.organizationId,
  projectId: row.projectId,
  name: row.name,
  description: row.description,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  status: row.status,
  suppressAlerts: row.suppressAlerts,
  suppressIncidents: row.suppressIncidents,
  allowAutonomous: row.allowAutonomous,
  remediationPolicy: row.remediationPolicy ?? null,
  createdById: row.createdById,
  cancelledById: row.cancelledById,
  cancelledAt: row.cancelledAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  serviceIds: row.Services.map((service) => service.serviceId)
});

const includeServices = { Services: { select: { serviceId: true } } } as const;

const deriveStatus = (startsAt: Date, endsAt: Date, current: MaintenanceWindowStatus): MaintenanceWindowStatus => {
  if (current === "CANCELLED" || current === "COMPLETED") return current;
  const now = Date.now();
  if (now < startsAt.getTime()) return "SCHEDULED";
  if (now > endsAt.getTime()) return "COMPLETED";
  return "ACTIVE";
};

export const listMaintenanceWindows = async (organizationId: string): Promise<MaintenanceWindowDto[]> => {
  const rows = await prisma.maintenanceWindow.findMany({
    where: { organizationId },
    include: includeServices,
    orderBy: { startsAt: "desc" },
    take: 200
  });
  return rows.map(toDto);
};

export const getMaintenanceWindow = async (
  organizationId: string,
  id: string
): Promise<MaintenanceWindowDto | null> => {
  const row = await prisma.maintenanceWindow.findFirst({
    where: { id, organizationId },
    include: includeServices
  });
  return row ? toDto(row) : null;
};

export const createMaintenanceWindow = async (input: {
  organizationId: string;
  projectId?: string | null;
  name: string;
  description?: string | null;
  startsAt: Date;
  endsAt: Date;
  suppressAlerts?: boolean;
  suppressIncidents?: boolean;
  allowAutonomous?: boolean;
  remediationPolicy?: string | null;
  serviceIds?: string[];
  createdById: string;
}): Promise<MaintenanceWindowDto> => {
  if (input.endsAt <= input.startsAt) {
    throw new Error("endsAt must be after startsAt");
  }

  const remediationPolicy = normalizeRemediationPolicy(input.remediationPolicy);

  if (input.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, organizationId: input.organizationId },
      select: { id: true }
    });
    if (!project) throw new Error("Project not found");
  }

  const serviceIds = input.serviceIds ?? [];
  if (serviceIds.length > 0) {
    const count = await prisma.service.count({
      where: {
        id: { in: serviceIds },
        Project: { organizationId: input.organizationId },
        ...(input.projectId ? { projectId: input.projectId } : {})
      }
    });
    if (count !== serviceIds.length) throw new Error("One or more services are invalid for this scope");
  }

  const now = new Date();
  const status = deriveStatus(input.startsAt, input.endsAt, "SCHEDULED");
  const id = randomUUID();

  const row = await prisma.maintenanceWindow.create({
    data: {
      id,
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status,
      suppressAlerts: input.suppressAlerts ?? true,
      suppressIncidents: input.suppressIncidents ?? false,
      allowAutonomous: input.allowAutonomous ?? false,
      remediationPolicy: remediationPolicy ?? null,
      createdById: input.createdById,
      updatedAt: now,
      Services: {
        create: serviceIds.map((serviceId) => ({
          id: randomUUID(),
          serviceId
        }))
      }
    },
    include: includeServices
  });

  return toDto(row);
};

export const updateMaintenanceWindow = async (input: {
  organizationId: string;
  id: string;
  name?: string;
  description?: string | null;
  startsAt?: Date;
  endsAt?: Date;
  suppressAlerts?: boolean;
  suppressIncidents?: boolean;
  allowAutonomous?: boolean;
  remediationPolicy?: string | null;
  serviceIds?: string[];
}): Promise<MaintenanceWindowDto> => {
  const existing = await prisma.maintenanceWindow.findFirst({
    where: { id: input.id, organizationId: input.organizationId },
    include: includeServices
  });
  if (!existing) throw new Error("Maintenance window not found");
  if (existing.status === "CANCELLED" || existing.status === "COMPLETED") {
    throw new Error("Cannot update a completed or cancelled maintenance window");
  }

  const startsAt = input.startsAt ?? existing.startsAt;
  const endsAt = input.endsAt ?? existing.endsAt;
  if (endsAt <= startsAt) throw new Error("endsAt must be after startsAt");

  const remediationPolicy =
    input.remediationPolicy !== undefined
      ? normalizeRemediationPolicy(input.remediationPolicy)
      : undefined;

  if (input.serviceIds) {
    const serviceIds = input.serviceIds;
    if (serviceIds.length > 0) {
      const count = await prisma.service.count({
        where: {
          id: { in: serviceIds },
          Project: { organizationId: input.organizationId },
          ...(existing.projectId ? { projectId: existing.projectId } : {})
        }
      });
      if (count !== serviceIds.length) throw new Error("One or more services are invalid for this scope");
    }
  }

  const status = deriveStatus(startsAt, endsAt, existing.status);

  await prisma.$transaction(async (tx) => {
    if (input.serviceIds) {
      await tx.maintenanceWindowService.deleteMany({ where: { maintenanceWindowId: input.id } });
      if (input.serviceIds.length > 0) {
        await tx.maintenanceWindowService.createMany({
          data: input.serviceIds.map((serviceId) => ({
            id: randomUUID(),
            maintenanceWindowId: input.id,
            serviceId
          }))
        });
      }
    }

    await tx.maintenanceWindow.update({
      where: { id: input.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        startsAt,
        endsAt,
        status,
        ...(input.suppressAlerts !== undefined ? { suppressAlerts: input.suppressAlerts } : {}),
        ...(input.suppressIncidents !== undefined ? { suppressIncidents: input.suppressIncidents } : {}),
        ...(input.allowAutonomous !== undefined ? { allowAutonomous: input.allowAutonomous } : {}),
        ...(remediationPolicy !== undefined ? { remediationPolicy } : {}),
        updatedAt: new Date()
      }
    });
  });

  const updated = await prisma.maintenanceWindow.findFirstOrThrow({
    where: { id: input.id },
    include: includeServices
  });
  return toDto(updated);
};

export const cancelMaintenanceWindow = async (input: {
  organizationId: string;
  id: string;
  cancelledById: string;
}): Promise<MaintenanceWindowDto> => {
  const existing = await prisma.maintenanceWindow.findFirst({
    where: { id: input.id, organizationId: input.organizationId }
  });
  if (!existing) throw new Error("Maintenance window not found");
  if (existing.status === "CANCELLED" || existing.status === "COMPLETED") {
    throw new Error("Maintenance window is already finished");
  }

  const now = new Date();
  const row = await prisma.maintenanceWindow.update({
    where: { id: input.id },
    data: {
      status: "CANCELLED",
      cancelledById: input.cancelledById,
      cancelledAt: now,
      updatedAt: now
    },
    include: includeServices
  });
  return toDto(row);
};

export const transitionMaintenanceWindowStatuses = async (): Promise<{
  activated: number;
  completed: number;
}> => {
  const now = new Date();
  const activated = await prisma.maintenanceWindow.updateMany({
    where: { status: "SCHEDULED", startsAt: { lte: now }, endsAt: { gte: now } },
    data: { status: "ACTIVE", updatedAt: now }
  });
  const completed = await prisma.maintenanceWindow.updateMany({
    where: {
      status: { in: ["SCHEDULED", "ACTIVE"] },
      endsAt: { lt: now }
    },
    data: { status: "COMPLETED", updatedAt: now }
  });
  return { activated: activated.count, completed: completed.count };
};
