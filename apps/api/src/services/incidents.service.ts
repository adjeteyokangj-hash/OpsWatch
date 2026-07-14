import { prisma } from "../lib/prisma";
import { IncidentStatus } from "@prisma/client";
import type {
  IncidentListItemDto,
  IncidentDetailDto,
  IncidentTimelineEventDto,
  RootCauseCandidateDto,
  OrganizationIncidentGroupDto
} from "../types/dto";

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
    include: {
      Project: { select: { id: true, name: true, projectOwner: true } },
      IncidentAlert: {
        include: {
          Alert: {
            include: { Service: { select: { id: true, name: true } } }
          }
        },
        take: 40
      },
      ChangeEvent: {
        select: { id: true },
        take: 10
      }
    },
    orderBy: { openedAt: "desc" }
  });

  return rows.map((r): IncidentListItemDto => {
    const serviceMap = new Map<string, { id: string; name: string }>();
    for (const link of r.IncidentAlert) {
      const service = link.Alert.Service;
      if (service) serviceMap.set(service.id, service);
    }
    return {
      id: r.id,
      title: r.title,
      severity: r.severity,
      status: r.status,
      openedAt: r.openedAt.toISOString(),
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      rootCause: r.rootCause ?? null,
      project: {
        id: r.Project.id,
        name: r.Project.name,
        owner: r.Project.projectOwner ?? null
      },
      alertCount: r.IncidentAlert.length,
      affectedServices: Array.from(serviceMap.values()),
      owner: r.Project.projectOwner ?? null,
      correlatedDeployCount: r.ChangeEvent.length
    };
  });
};

type IncidentDetailRecord = NonNullable<
  Awaited<ReturnType<typeof prisma.incident.findUnique>>
> & {
  Project: { id: string; name: string; organizationId: string | null; projectOwner?: string | null };
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
  CorrelationGroup?: {
    id: string;
    correlationKey: string;
    rootCauseSummary: string | null;
    primaryIncidentId: string | null;
    Incidents: Array<{
      id: string;
      title: string;
      severity: string;
      status: string;
      Project: { id: string; name: string };
    }>;
  } | null;
};

const mapCorrelationGroup = (
  group: NonNullable<IncidentDetailRecord["CorrelationGroup"]>
): OrganizationIncidentGroupDto => ({
  id: group.id,
  correlationKey: group.correlationKey,
  rootCauseSummary: group.rootCauseSummary,
  primaryIncidentId: group.primaryIncidentId,
  relatedIncidents: group.Incidents.map((row) => ({
    id: row.id,
    title: row.title,
    severity: row.severity,
    status: row.status,
    project: { id: row.Project.id, name: row.Project.name }
  }))
});

export const mapIncidentDetail = (r: IncidentDetailRecord): IncidentDetailDto => {
  const serviceMap = new Map<string, { id: string; name: string }>();
  for (const ref of r.IncidentAlert) {
    const service = ref.Alert.Service;
    if (service) serviceMap.set(service.id, service);
  }

  const owner = r.Project.projectOwner ?? null;

  return {
    id: r.id,
    title: r.title,
    severity: r.severity,
    status: r.status,
    openedAt: r.openedAt.toISOString(),
    acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    rootCause: r.rootCause,
    resolutionNotes: r.resolutionNotes,
    project: { id: r.Project.id, name: r.Project.name, owner },
    alertCount: r.IncidentAlert.length,
    affectedServices: Array.from(serviceMap.values()),
    owner,
    correlatedDeployCount: 0,
    alerts: r.IncidentAlert.map((ref) => ({
      id: ref.Alert.id,
      title: ref.Alert.title,
      severity: ref.Alert.severity,
      status: ref.Alert.status,
      lastSeenAt: ref.Alert.lastSeenAt.toISOString(),
      service: ref.Alert.Service
        ? { id: ref.Alert.Service.id, name: ref.Alert.Service.name }
        : null
    })),
    correlationGroup: r.CorrelationGroup ? mapCorrelationGroup(r.CorrelationGroup) : null
  };
};

const clampScore = (value: number): number => Math.max(0, Math.min(1, Number(value.toFixed(2))));

export const listIncidentTimeline = async (
  organizationId: string,
  incidentId: string,
  take = 200
): Promise<IncidentTimelineEventDto[] | null> => {
  const incident = await prisma.incident.findFirst({
    where: { id: incidentId, Project: { organizationId } },
    select: { id: true, projectId: true, openedAt: true, resolvedAt: true, title: true }
  });

  if (!incident) {
    return null;
  }

  const rows = await prisma.incidentTimelineEvent.findMany({
    where: { incidentId: incident.id, projectId: incident.projectId },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    take: Math.max(1, Math.min(take, 500))
  });

  const mapped = rows.map((row): IncidentTimelineEventDto => ({
    id: row.id,
    incidentId: row.incidentId,
    projectId: row.projectId,
    eventType: row.eventType,
    summary: row.summary,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    severity: row.severity,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    payloadJson: row.payloadJson
  }));

  if (mapped.length > 0) {
    return mapped;
  }

  const fallback: IncidentTimelineEventDto[] = [
    {
      id: `${incident.id}:opened`,
      incidentId: incident.id,
      projectId: incident.projectId,
      eventType: "INCIDENT_OPENED",
      summary: `Incident opened: ${incident.title}`,
      sourceType: "INCIDENT",
      sourceId: incident.id,
      severity: null,
      occurredAt: incident.openedAt.toISOString(),
      createdAt: incident.openedAt.toISOString(),
      payloadJson: null
    }
  ];

  if (incident.resolvedAt) {
    fallback.push({
      id: `${incident.id}:resolved`,
      incidentId: incident.id,
      projectId: incident.projectId,
      eventType: "INCIDENT_RESOLVED",
      summary: "Incident resolved",
      sourceType: "INCIDENT",
      sourceId: incident.id,
      severity: null,
      occurredAt: incident.resolvedAt.toISOString(),
      createdAt: incident.resolvedAt.toISOString(),
      payloadJson: null
    });
  }

  return fallback;
};

export const listIncidentRootCauseCandidates = async (
  organizationId: string,
  incidentId: string
): Promise<RootCauseCandidateDto[] | null> => {
  const incident = await prisma.incident.findFirst({
    where: { id: incidentId, Project: { organizationId } },
    include: {
      Project: { select: { id: true, name: true } },
      IncidentAlert: {
        include: {
          Alert: {
            select: {
              id: true,
              title: true,
              status: true,
              sourceType: true,
              serviceId: true,
              category: true,
              severity: true,
              firstSeenAt: true,
              lastSeenAt: true
            }
          }
        }
      }
    }
  });

  if (!incident) {
    return null;
  }

  const impactedServiceIds = new Set(
    incident.IncidentAlert.map((row) => row.Alert.serviceId).filter((v): v is string => Boolean(v))
  );

  const openedAt = incident.openedAt;
  const windowStart = new Date(openedAt.getTime() - 30 * 60_000);
  const windowEnd = new Date(openedAt.getTime() + 15 * 60_000);

  const [changeEvents, dependencies] = await Promise.all([
    prisma.changeEvent.findMany({
      where: {
        organizationId,
        projectId: incident.projectId,
        occurredAt: { gte: windowStart, lte: windowEnd },
        ...(impactedServiceIds.size > 0
          ? {
              OR: [
                { serviceId: { in: Array.from(impactedServiceIds) } },
                { serviceId: null }
              ]
            }
          : {})
      },
      orderBy: { occurredAt: "desc" },
      take: 50
    }),
    prisma.serviceDependency.findMany({
      where: {
        projectId: incident.projectId,
        isActive: true,
        ...(impactedServiceIds.size > 0
          ? {
              OR: [
                { fromServiceId: { in: Array.from(impactedServiceIds) } },
                { toServiceId: { in: Array.from(impactedServiceIds) } }
              ]
            }
          : {})
      },
      include: {
        FromService: { select: { id: true, name: true } },
        ToService: { select: { id: true, name: true } }
      },
      take: 50
    })
  ]);

  const candidates: RootCauseCandidateDto[] = [];

  for (const change of changeEvents) {
    const impactsService = change.serviceId ? impactedServiceIds.has(change.serviceId) : false;
    const deployLike = /(DEPLOY|ROLLBACK|CONFIG|MIGRATION)/i.test(change.eventType);
    const score = clampScore(0.55 + (impactsService ? 0.2 : 0) + (deployLike ? 0.15 : 0));
    candidates.push({
      kind: "CHANGE_EVENT",
      referenceId: change.id,
      title: `${change.eventType}: ${change.summary}`,
      score,
      rationale: impactsService
        ? "Change event touched an impacted service close to incident start time."
        : "Change event occurred close to incident start time.",
      metadata: {
        occurredAt: change.occurredAt.toISOString(),
        serviceId: change.serviceId,
        incidentWindowStart: windowStart.toISOString(),
        incidentWindowEnd: windowEnd.toISOString()
      }
    });
  }

  for (const dep of dependencies) {
    const criticalityWeight = dep.criticality === "CRITICAL" ? 0.4 : dep.criticality === "HIGH" ? 0.25 : dep.criticality === "MEDIUM" ? 0.1 : 0;
    const upstreamEvidence = impactedServiceIds.has(dep.toServiceId) ? 0.1 : 0;
    const score = clampScore(0.45 + criticalityWeight + upstreamEvidence);
    candidates.push({
      kind: "DEPENDENCY",
      referenceId: dep.id,
      title: `${dep.FromService.name} depends on ${dep.ToService.name}`,
      score,
      rationale: "Impacted services have an active dependency edge that may explain cascading failure.",
      metadata: {
        fromServiceId: dep.fromServiceId,
        toServiceId: dep.toServiceId,
        dependencyType: dep.dependencyType,
        criticality: dep.criticality
      }
    });
  }

  for (const ref of incident.IncidentAlert) {
    const alert = ref.Alert;
    const ageMinutes = Math.round((openedAt.getTime() - alert.firstSeenAt.getTime()) / 60_000);
    const score = clampScore(0.35 + (alert.status === "OPEN" ? 0.2 : 0) + (alert.severity === "CRITICAL" ? 0.2 : 0));
    candidates.push({
      kind: "ALERT_SIGNAL",
      referenceId: alert.id,
      title: `${alert.sourceType}: ${alert.title}`,
      score,
      rationale: "Alert signal is directly linked to this incident and contributes to root-cause ranking.",
      metadata: {
        serviceId: alert.serviceId,
        category: alert.category,
        severity: alert.severity,
        status: alert.status,
        firstSeenAt: alert.firstSeenAt.toISOString(),
        ageMinutesAtIncidentOpen: ageMinutes
      }
    });
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 12);
};
