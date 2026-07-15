import { createHash, randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { correlateOrganizationIncidents } from "./org-incident-correlation";

const isAlertUnderIncidentSuppression = async (input: {
  organizationId: string;
  projectId: string;
  serviceId: string | null;
}): Promise<boolean> => {
  const now = new Date();
  const windows = await prisma.maintenanceWindow.findMany({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      suppressIncidents: true,
      startsAt: { lte: now },
      endsAt: { gte: now },
      OR: [{ projectId: null }, { projectId: input.projectId }]
    },
    include: { Services: { select: { serviceId: true } } }
  });
  return windows.some((window) => {
    const scoped = window.Services.map((row) => row.serviceId);
    return scoped.length === 0 || (input.serviceId != null && scoped.includes(input.serviceId));
  });
};

type CorrelationAlert = { id: string; projectId: string; serviceId: string | null; severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; title: string; firstSeenAt: Date };
type CorrelationEdge = { fromServiceId: string; toServiceId: string };

export const groupCorrelatedAlerts = (alerts: CorrelationAlert[], edges: CorrelationEdge[]): CorrelationAlert[][] => {
  const neighbors = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!neighbors.has(edge.fromServiceId)) neighbors.set(edge.fromServiceId, new Set());
    if (!neighbors.has(edge.toServiceId)) neighbors.set(edge.toServiceId, new Set());
    neighbors.get(edge.fromServiceId)!.add(edge.toServiceId);
    neighbors.get(edge.toServiceId)!.add(edge.fromServiceId);
  }
  const component = (serviceId: string) => {
    const found = new Set<string>(); const queue = [serviceId];
    while (queue.length) { const current = queue.shift()!; if (found.has(current)) continue; found.add(current); queue.push(...(neighbors.get(current) ?? [])); }
    return found;
  };
  const groups: CorrelationAlert[][] = [];
  for (const alert of alerts) {
    const match = groups.find(group => group.some(existing => existing.projectId === alert.projectId && (
      (!existing.serviceId && !alert.serviceId) ||
      (existing.serviceId && alert.serviceId && component(existing.serviceId).has(alert.serviceId))
    )));
    if (match) match.push(alert); else groups.push([alert]);
  }
  return groups;
};

const severityRank = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 } as const;

const createIncidentsForUnlinkedAlerts = async (): Promise<number> => {
  const cutoff = new Date(Date.now() - 30 * 60_000);
  const alerts = await prisma.alert.findMany({
    where: { status: { in: ["OPEN", "ACKNOWLEDGED"] }, firstSeenAt: { gte: cutoff }, IncidentAlert: { none: {} } },
    select: { id: true, projectId: true, serviceId: true, severity: true, title: true, firstSeenAt: true }, orderBy: { firstSeenAt: "asc" }
  });
  let created = 0;
  for (const projectId of new Set(alerts.map(row => row.projectId))) {
    const projectAlerts = alerts.filter(row => row.projectId === projectId);
    const edges = await prisma.serviceDependency.findMany({
      where: { projectId, isActive: true, dependencyType: "RUNTIME" },
      select: { fromServiceId: true, toServiceId: true }
    });
    for (const group of groupCorrelatedAlerts(projectAlerts, edges)) {
      const lead = [...group].sort((a, b) => severityRank[b.severity] - severityRank[a.severity])[0]!;
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { organizationId: true }
      });
      if (project?.organizationId) {
        const suppressed = await isAlertUnderIncidentSuppression({
          organizationId: project.organizationId,
          projectId,
          serviceId: lead.serviceId
        });
        if (suppressed) continue;
      }
      const incidentId = randomUUID();
      const fingerprints = group
        .map((alert) => `${alert.projectId}|${alert.serviceId ?? ""}|${alert.title}`)
        .sort();
      const fingerprint = createHash("sha256").update(fingerprints.join(",")).digest("hex").slice(0, 32);
      await prisma.incident.create({
        data: {
          id: incidentId, projectId, severity: lead.severity,
          title: group.length > 1 ? `${lead.title} and ${group.length - 1} related alert${group.length > 2 ? "s" : ""}` : lead.title,
          openedAt: group[0]!.firstSeenAt,
          fingerprint,
          IncidentAlert: { create: group.map(alert => ({ alertId: alert.id })) }
        }
      });
      created += 1;
    }
  }
  return created;
};

const ensureTimelineEvent = async (input: {
  incidentId: string;
  projectId: string;
  eventType: string;
  summary: string;
  sourceType?: string | null;
  sourceId?: string | null;
  severity?: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  occurredAt: Date;
  payloadJson?: Record<string, unknown> | null;
}): Promise<boolean> => {
  const existing = await prisma.incidentTimelineEvent.findFirst({
    where: {
      incidentId: input.incidentId,
      eventType: input.eventType,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null
    },
    select: { id: true }
  });

  if (existing) {
    return false;
  }

  const incident = await prisma.incident.findUnique({
    where: { id: input.incidentId },
    select: { id: true }
  });
  if (!incident) {
    return false;
  }

  try {
    await prisma.incidentTimelineEvent.create({
    data: {
      id: randomUUID(),
      incidentId: input.incidentId,
      projectId: input.projectId,
      eventType: input.eventType,
      summary: input.summary,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      severity: input.severity ?? null,
      occurredAt: input.occurredAt,
      payloadJson: input.payloadJson as Prisma.InputJsonValue | undefined
    }
  });
  } catch (error) {
    logger.warn("Skipped timeline event for missing or deleted incident", {
      incidentId: input.incidentId,
      eventType: input.eventType,
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }

  return true;
};

export const runIncidentCorrelationJob = async (): Promise<void> => {
  const incidentsCreated = await createIncidentsForUnlinkedAlerts();
  const orgGroupsCreated = await correlateOrganizationIncidents();
  const incidents = await prisma.incident.findMany({
    where: { status: { in: ["OPEN", "INVESTIGATING", "MONITORING"] } },
    include: {
      IncidentAlert: {
        include: {
          Alert: {
            select: {
              id: true,
              title: true,
              sourceType: true,
              sourceId: true,
              severity: true,
              serviceId: true,
              firstSeenAt: true,
              status: true
            }
          }
        }
      }
    }
  });

  let timelineEventsCreated = 0;

  for (const incident of incidents) {
    const baselineEvent = await prisma.incidentTimelineEvent.findFirst({
      where: {
        incidentId: incident.id,
        eventType: "INCIDENT_OPENED",
        sourceType: "INCIDENT",
        sourceId: incident.id
      },
      select: { id: true }
    });

    if (!baselineEvent) {
      if (await ensureTimelineEvent({
        incidentId: incident.id,
        projectId: incident.projectId,
        eventType: "INCIDENT_OPENED",
        summary: `Incident opened: ${incident.title}`,
        sourceType: "INCIDENT",
        sourceId: incident.id,
        occurredAt: incident.openedAt,
        payloadJson: {
          severity: incident.severity,
          status: incident.status
        }
      })) {
        timelineEventsCreated += 1;
      }
    }

    for (const ref of incident.IncidentAlert) {
      if (await ensureTimelineEvent({
        incidentId: incident.id,
        projectId: incident.projectId,
        eventType: "ALERT_CORRELATED",
        summary: `Alert correlated: ${ref.Alert.title}`,
        sourceType: "ALERT",
        sourceId: ref.Alert.id,
        severity: ref.Alert.severity,
        occurredAt: ref.Alert.firstSeenAt,
        payloadJson: {
          alertSourceType: ref.Alert.sourceType,
          alertSourceId: ref.Alert.sourceId,
          serviceId: ref.Alert.serviceId,
          status: ref.Alert.status
        }
      })) {
        timelineEventsCreated += 1;
      }
      if (ref.Alert.status === "RESOLVED" && await ensureTimelineEvent({
        incidentId: incident.id,
        projectId: incident.projectId,
        eventType: "ALERT_RECOVERED",
        summary: `Alert recovered: ${ref.Alert.title}`,
        sourceType: "ALERT",
        sourceId: ref.Alert.id,
        severity: ref.Alert.severity,
        occurredAt: new Date(),
        payloadJson: { serviceId: ref.Alert.serviceId, status: ref.Alert.status }
      })) timelineEventsCreated += 1;
    }

    const impactedServiceIds = Array.from(
      new Set(refsToServiceIds(incident.IncidentAlert.map((ref) => ref.Alert.serviceId)))
    );

    const changeWindowStart = new Date(incident.openedAt.getTime() - 30 * 60_000);
    const changeWindowEnd = new Date(incident.openedAt.getTime() + 15 * 60_000);

    const correlatedChanges = await prisma.changeEvent.findMany({
      where: {
        projectId: incident.projectId,
        occurredAt: { gte: changeWindowStart, lte: changeWindowEnd },
        ...(impactedServiceIds.length > 0
          ? {
              OR: [{ serviceId: { in: impactedServiceIds } }, { serviceId: null }]
            }
          : {})
      },
      orderBy: { occurredAt: "desc" },
      take: 20
    });

    for (const change of correlatedChanges) {
      if (await ensureTimelineEvent({
        incidentId: incident.id,
        projectId: incident.projectId,
        eventType: "CHANGE_CORRELATED",
        summary: `${change.eventType}: ${change.summary}`,
        sourceType: "CHANGE_EVENT",
        sourceId: change.id,
        occurredAt: change.occurredAt,
        payloadJson: {
          actor: change.actor,
          serviceId: change.serviceId,
          details: change.detailsJson
        }
      })) {
        timelineEventsCreated += 1;
      }
    }

    if (impactedServiceIds.length > 0) {
      const dependencyEdges = await prisma.serviceDependency.findMany({
        where: {
          projectId: incident.projectId,
          isActive: true,
          OR: [
            { fromServiceId: { in: impactedServiceIds } },
            { toServiceId: { in: impactedServiceIds } }
          ]
        },
        include: {
          FromService: { select: { id: true, name: true } },
          ToService: { select: { id: true, name: true } }
        },
        take: 20
      });

      for (const edge of dependencyEdges) {
        if (await ensureTimelineEvent({
          incidentId: incident.id,
          projectId: incident.projectId,
          eventType: "DEPENDENCY_RISK",
          summary: `Dependency edge: ${edge.FromService.name} -> ${edge.ToService.name}`,
          sourceType: "SERVICE_DEPENDENCY",
          sourceId: edge.id,
          occurredAt: incident.openedAt,
          payloadJson: {
            fromServiceId: edge.fromServiceId,
            toServiceId: edge.toServiceId,
            criticality: edge.criticality,
            dependencyType: edge.dependencyType
          }
        })) {
          timelineEventsCreated += 1;
        }
      }
    }
  }

  logger.info(`Incident correlation created ${incidentsCreated} incidents, linked ${orgGroupsCreated} organization groups, processed ${incidents.length} incidents, and created ${timelineEventsCreated} timeline events`);
};

const refsToServiceIds = (values: Array<string | null>): string[] => values.filter((value): value is string => Boolean(value));
