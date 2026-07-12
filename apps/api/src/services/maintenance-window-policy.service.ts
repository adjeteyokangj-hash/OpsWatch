import type { MaintenanceWindowStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";

export type MaintenancePolicyResult = {
  inMaintenance: boolean;
  windowId?: string;
  windowName?: string;
  suppressAlerts: boolean;
  suppressIncidents: boolean;
  allowAutonomous: boolean;
};

const ACTIVE_STATUSES: MaintenanceWindowStatus[] = ["ACTIVE"];

export const findActiveMaintenanceForService = async (input: {
  organizationId: string;
  projectId: string;
  serviceId?: string | null;
  at?: Date;
}): Promise<MaintenancePolicyResult> => {
  const at = input.at ?? new Date();

  const windows = await prisma.maintenanceWindow.findMany({
    where: {
      organizationId: input.organizationId,
      status: { in: ACTIVE_STATUSES },
      startsAt: { lte: at },
      endsAt: { gte: at },
      OR: [{ projectId: null }, { projectId: input.projectId }]
    },
    include: {
      Services: { select: { serviceId: true } }
    }
  });

  for (const window of windows) {
    const scopedServiceIds = window.Services.map((row) => row.serviceId);
    const appliesToService =
      scopedServiceIds.length === 0 ||
      (input.serviceId != null && scopedServiceIds.includes(input.serviceId));

    if (!appliesToService) continue;

    return {
      inMaintenance: true,
      windowId: window.id,
      windowName: window.name,
      suppressAlerts: window.suppressAlerts,
      suppressIncidents: window.suppressIncidents,
      allowAutonomous: window.allowAutonomous
    };
  }

  return {
    inMaintenance: false,
    suppressAlerts: false,
    suppressIncidents: false,
    allowAutonomous: false
  };
};

export const listActiveMaintenanceWindows = async (input: {
  organizationId: string;
  projectId?: string;
}): Promise<
  Array<{
    id: string;
    name: string;
    description: string | null;
    startsAt: Date;
    endsAt: Date;
    projectId: string | null;
    suppressAlerts: boolean;
    suppressIncidents: boolean;
    allowAutonomous: boolean;
    serviceIds: string[];
  }>
> => {
  const now = new Date();
  const rows = await prisma.maintenanceWindow.findMany({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      startsAt: { lte: now },
      endsAt: { gte: now },
      ...(input.projectId ? { OR: [{ projectId: null }, { projectId: input.projectId }] } : {})
    },
    include: { Services: { select: { serviceId: true } } },
    orderBy: { startsAt: "asc" }
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    projectId: row.projectId,
    suppressAlerts: row.suppressAlerts,
    suppressIncidents: row.suppressIncidents,
    allowAutonomous: row.allowAutonomous,
    serviceIds: row.Services.map((service) => service.serviceId)
  }));
};
