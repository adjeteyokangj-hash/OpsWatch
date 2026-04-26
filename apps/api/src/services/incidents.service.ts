import { prisma } from "../lib/prisma";
import { IncidentStatus } from "@prisma/client";
import type { IncidentListItemDto, IncidentDetailDto } from "../types/dto";

type IncidentListFilters = {
  projectId?: string;
  severity?: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status?: "OPEN" | "INVESTIGATING" | "MONITORING" | "RESOLVED";
  q?: string;
  onlyOpen?: boolean;
  onlyUnresolved?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
};

export const listIncidents = async (organizationId: string, filters: IncidentListFilters = {}) => {
  const unresolvedStatuses: IncidentStatus[] = ["OPEN", "INVESTIGATING", "MONITORING"];

  const where = {
    Project: {
      organizationId,
      ...(filters.projectId ? { id: filters.projectId } : {})
    },
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(
      filters.onlyOpen
        ? { status: "OPEN" as const }
        : filters.onlyUnresolved
          ? { status: { in: unresolvedStatuses } }
          : {}
    ),
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q, mode: "insensitive" as const } },
            { rootCause: { contains: filters.q, mode: "insensitive" as const } }
          ]
        }
      : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          openedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {})
          }
        }
      : {})
  };

  const rows = await prisma.incident.findMany({
    where,
    include: { Project: true },
    orderBy: { openedAt: "desc" }
  });

  return rows.map((r): IncidentListItemDto => ({
    id: r.id,
    title: r.title,
    severity: r.severity,
    status: r.status,
    openedAt: r.openedAt.toISOString(),
    acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    project: { id: r.Project.id, name: r.Project.name }
  }));
};

type IncidentDetailRecord = NonNullable<
  Awaited<ReturnType<typeof prisma.incident.findUnique>>
> & {
  Project: { id: string; name: string; organizationId: string | null };
  IncidentAlert: Array<{
    Alert: {
      id: string;
      title: string;
      severity: string;
      status: string;
      lastSeenAt: Date;
      Service: { id: string; name: string } | null;
    };
  }>;
};

export const mapIncidentDetail = (r: IncidentDetailRecord): IncidentDetailDto => ({
  id: r.id,
  title: r.title,
  severity: r.severity,
  status: r.status,
  openedAt: r.openedAt.toISOString(),
  acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
  resolvedAt: r.resolvedAt?.toISOString() ?? null,
  rootCause: r.rootCause,
  resolutionNotes: r.resolutionNotes,
  project: { id: r.Project.id, name: r.Project.name },
  alerts: r.IncidentAlert.map((ref) => ({
    id: ref.Alert.id,
    title: ref.Alert.title,
    severity: ref.Alert.severity,
    status: ref.Alert.status,
    lastSeenAt: ref.Alert.lastSeenAt.toISOString(),
    service: ref.Alert.Service
      ? { id: ref.Alert.Service.id, name: ref.Alert.Service.name }
      : null
  }))
});
