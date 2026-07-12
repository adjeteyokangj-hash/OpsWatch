import { prisma } from "../lib/prisma";
import type { ProjectTopologyResponse } from "../types/dto";
import { buildProjectTopologyResponse } from "./topology.service";

const unresolvedIncidentStatuses = ["OPEN", "INVESTIGATING", "MONITORING"] as const;
const openAlertStatuses = ["OPEN", "ACKNOWLEDGED"] as const;

export const loadProjectTopology = async (
  organizationId: string,
  projectId: string
): Promise<ProjectTopologyResponse | null> => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true, name: true, status: true }
  });
  if (!project) return null;

  const [services, dependencies, alerts, incidents, sloDefinitions] = await Promise.all([
    prisma.service.findMany({
      where: { projectId },
      include: {
        Check: {
          where: { isActive: true },
          include: {
            CheckResult: { orderBy: { checkedAt: "desc" }, take: 12 }
          }
        }
      },
      orderBy: { name: "asc" }
    }),
    prisma.serviceDependency.findMany({
      where: { projectId, isActive: true },
      select: {
        id: true,
        fromServiceId: true,
        toServiceId: true,
        dependencyType: true,
        criticality: true,
        isActive: true
      }
    }),
    prisma.alert.findMany({
      where: { projectId, status: { in: [...openAlertStatuses] } },
      select: { id: true, title: true, severity: true, status: true, serviceId: true }
    }),
    prisma.incident.findMany({
      where: { projectId, status: { in: [...unresolvedIncidentStatuses] } },
      select: {
        id: true,
        title: true,
        severity: true,
        status: true,
        IncidentAlert: {
          select: {
            Alert: { select: { serviceId: true } }
          }
        }
      }
    }),
    prisma.sLODefinition.findMany({
      where: { projectId, enabled: true, archivedAt: null },
      select: {
        serviceId: true,
        SLOWindow: { orderBy: { windowEnd: "desc" }, take: 1 }
      }
    })
  ]);

  return buildProjectTopologyResponse({
    project,
    services,
    dependencies,
    alerts,
    incidents: incidents.map((row) => ({
      id: row.id,
      title: row.title,
      severity: row.severity,
      status: row.status,
      serviceIds: Array.from(
        new Set(
          row.IncidentAlert.map((ref) => ref.Alert.serviceId).filter((value): value is string => Boolean(value))
        )
      )
    })),
    slos: sloDefinitions.map((row) => ({
      serviceId: row.serviceId,
      latestWindow: row.SLOWindow[0]
        ? {
            status: row.SLOWindow[0].status,
            availabilityPct: row.SLOWindow[0].availabilityPct,
            errorRatePct: row.SLOWindow[0].errorRatePct,
            p95LatencyMs: row.SLOWindow[0].p95LatencyMs,
            burnRate: row.SLOWindow[0].burnRate
          }
        : null
    }))
  });
};
