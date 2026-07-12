import type { ProjectStatus, ServiceType } from "@prisma/client";
import { prisma } from "../lib/prisma";

export type LayerHealthRow = {
  layer: "APPLICATION" | "MODULE" | "WORKFLOW" | "COMPONENT";
  label: string;
  total: number;
  healthy: number;
  warning: number;
  critical: number;
  unknown: number;
};

const warningStatuses: ProjectStatus[] = ["DEGRADED", "RECOVERING", "MAINTENANCE", "PAUSED"];
const criticalStatuses: ProjectStatus[] = ["DOWN"];

const countByStatus = (statuses: ProjectStatus[]) => {
  let healthy = 0;
  let warning = 0;
  let critical = 0;
  let unknown = 0;
  for (const status of statuses) {
    if (status === "HEALTHY") healthy += 1;
    else if (criticalStatuses.includes(status)) critical += 1;
    else if (warningStatuses.includes(status)) warning += 1;
    else unknown += 1;
  }
  return { healthy, warning, critical, unknown, total: statuses.length };
};

const componentTypes: ServiceType[] = [
  "COMPONENT",
  "FRONTEND",
  "API",
  "DATABASE",
  "WORKER",
  "WEBHOOK",
  "EMAIL",
  "PAYMENT",
  "THIRD_PARTY"
];

export const buildLayerHealthRollup = async (organizationId: string): Promise<LayerHealthRow[]> => {
  const [projects, services] = await Promise.all([
    prisma.project.findMany({
      where: { organizationId, isActive: true },
      select: { status: true }
    }),
    prisma.service.findMany({
      where: { Project: { organizationId, isActive: true } },
      select: { type: true, status: true }
    })
  ]);

  const appCounts = countByStatus(projects.map((row) => row.status));
  const moduleStatuses = services.filter((row) => row.type === "MODULE").map((row) => row.status);
  const workflowStatuses = services.filter((row) => row.type === "WORKFLOW").map((row) => row.status);
  const componentStatuses = services.filter((row) => componentTypes.includes(row.type)).map((row) => row.status);

  return [
    { layer: "APPLICATION", label: "Application health", ...appCounts },
    { layer: "MODULE", label: "Module health", ...countByStatus(moduleStatuses) },
    { layer: "WORKFLOW", label: "Workflow health", ...countByStatus(workflowStatuses) },
    { layer: "COMPONENT", label: "Component health", ...countByStatus(componentStatuses) }
  ];
};
