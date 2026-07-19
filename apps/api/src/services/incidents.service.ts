import { prisma } from "../lib/prisma";
import { IncidentStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import type {
  IncidentListItemDto,
  IncidentDetailDto,
  IncidentTimelineEventDto,
  RootCauseCandidateDto,
  OrganizationIncidentGroupDto
} from "../types/dto";
import {
  buildIncidentFingerprint,
  canReopenIncident,
  classifySignalLayer,
  labelRcaConfidence
} from "./alert-correlation.service";

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
  OtelIncidentEvidence?: Array<{
    id: string;
    evidenceKind: string;
    summary: string;
    confidence: number | null;
    traceId: string | null;
    spanId: string | null;
    propagationDirection: string | null;
    candidateRootCause: boolean;
    observedAt: Date;
  }>;
  LogEvidenceLink?: Array<{
    id: string;
    evidenceKind: string;
    summary: string;
    confidence: number | null;
    occurrenceGroupId: string | null;
    observedAt: Date;
  }>;
  SpanEvidenceLink?: Array<{
    id: string;
    evidenceKind: string;
    summary: string;
    confidence: number | null;
    traceId: string | null;
    spanId: string | null;
    observedAt: Date;
  }>;
  ApmEvidenceLink?: Array<{
    id: string;
    evidenceKind: string;
    summary: string;
    confidence: number | null;
    serviceWindowId: string | null;
    dependencyWindowId: string | null;
    observedAt: Date;
  }>;
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
    correlationGroup: r.CorrelationGroup ? mapCorrelationGroup(r.CorrelationGroup) : null,
    otelEvidence: (r.OtelIncidentEvidence ?? []).map((row) => ({
      id: row.id,
      evidenceKind: row.evidenceKind,
      summary: row.summary,
      confidence: row.confidence,
      traceId: row.traceId,
      spanId: row.spanId,
      propagationDirection: row.propagationDirection,
      candidateRootCause: row.candidateRootCause,
      observedAt: row.observedAt.toISOString()
    })),
    logEvidence: (r.LogEvidenceLink ?? []).map((row) => ({
      id: row.id,
      evidenceKind: row.evidenceKind,
      summary: row.summary,
      confidence: row.confidence,
      occurrenceGroupId: row.occurrenceGroupId,
      observedAt: row.observedAt.toISOString()
    })),
    spanEvidence: (r.SpanEvidenceLink ?? []).map((row) => ({
      id: row.id,
      evidenceKind: row.evidenceKind,
      summary: row.summary,
      confidence: row.confidence,
      traceId: row.traceId,
      spanId: row.spanId,
      observedAt: row.observedAt.toISOString()
    })),
    apmEvidence: (r.ApmEvidenceLink ?? []).map((row) => ({
      id: row.id,
      evidenceKind: row.evidenceKind,
      summary: row.summary,
      confidence: row.confidence,
      serviceWindowId: row.serviceWindowId,
      dependencyWindowId: row.dependencyWindowId,
      observedAt: row.observedAt.toISOString()
    }))
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
    const supportingEvidenceCount = (impactsService ? 1 : 0) + (deployLike ? 1 : 0);
    candidates.push({
      kind: "CHANGE_EVENT",
      referenceId: change.id,
      title: `${change.eventType}: ${change.summary}`,
      score,
      confidenceLabel: labelRcaConfidence({ score, supportingEvidenceCount }),
      rationale: impactsService
        ? "Change event touched an impacted service close to incident start time."
        : "Change event occurred close to incident start time.",
      evidenceSummary: [
        `Occurred ${change.occurredAt.toISOString()}`,
        impactsService ? "Touches impacted service" : "Project-scoped change",
        deployLike ? "Deploy/config-like change type" : "Non-deploy change type"
      ],
      alternativeCauses: [],
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
    const supportingEvidenceCount = (upstreamEvidence > 0 ? 1 : 0) + (criticalityWeight >= 0.25 ? 1 : 0);
    candidates.push({
      kind: "DEPENDENCY",
      referenceId: dep.id,
      title: `${dep.FromService.name} depends on ${dep.ToService.name}`,
      score,
      confidenceLabel: labelRcaConfidence({ score, supportingEvidenceCount }),
      rationale: "Impacted services have an active dependency edge that may explain cascading failure.",
      evidenceSummary: [
        `Dependency type ${dep.dependencyType}`,
        `Criticality ${dep.criticality}`,
        upstreamEvidence > 0 ? "Upstream service is in impacted set" : "Edge adjacent to impacted set"
      ],
      alternativeCauses: [],
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
    const supportingEvidenceCount = (alert.status === "OPEN" ? 1 : 0) + (alert.severity === "CRITICAL" ? 1 : 0);
    candidates.push({
      kind: "ALERT_SIGNAL",
      referenceId: alert.id,
      title: `${alert.sourceType}: ${alert.title}`,
      score,
      confidenceLabel: labelRcaConfidence({ score, supportingEvidenceCount }),
      rationale: "Alert signal is directly linked to this incident and contributes to root-cause ranking.",
      evidenceSummary: [
        `Severity ${alert.severity}`,
        `Status ${alert.status}`,
        `First seen ${alert.firstSeenAt.toISOString()}`
      ],
      alternativeCauses: [],
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

  const ranked = candidates.sort((a, b) => b.score - a.score).slice(0, 12);
  for (const candidate of ranked) {
    candidate.alternativeCauses = ranked
      .filter((other) => other.referenceId !== candidate.referenceId)
      .slice(0, 3)
      .map((other) => `${other.confidenceLabel}: ${other.title}`);
  }
  return ranked;
};

export const getIncidentIntelligenceSummary = async (
  organizationId: string,
  incidentId: string
) => {
  const incident = await prisma.incident.findFirst({
    where: { id: incidentId, Project: { organizationId } },
    include: {
      IncidentAlert: {
        include: {
          Alert: {
            select: {
              id: true,
              title: true,
              status: true,
              fingerprint: true,
              occurrenceCount: true,
              severity: true,
              serviceId: true
            }
          }
        }
      },
      MergedFrom: { select: { id: true, title: true, status: true } }
    }
  });
  if (!incident) return null;

  const candidates = await listIncidentRootCauseCandidates(organizationId, incidentId);
  const alertCount = incident.IncidentAlert.length;
  const layer = classifySignalLayer({
    hasLinkedIncident: true,
    correlatedAlertCount: alertCount
  });
  const fingerprints = incident.IncidentAlert.map((row) => row.Alert.fingerprint).filter(
    (v): v is string => Boolean(v)
  );

  return {
    incidentId: incident.id,
    signalLayer: layer,
    fingerprint: incident.fingerprint ?? buildIncidentFingerprint(fingerprints),
    mergedIntoIncidentId: incident.mergedIntoIncidentId,
    mergedFromCount: incident.MergedFrom.length,
    reopenCount: incident.reopenCount,
    alertCount,
    topCandidate: candidates?.[0] ?? null,
    candidates: candidates ?? [],
    evidenceOnly: true
  };
};

export const mergeIncidents = async (
  organizationId: string,
  sourceIncidentId: string,
  targetIncidentId: string
): Promise<{ ok: true } | { ok: false; error: string; status: number }> => {
  if (sourceIncidentId === targetIncidentId) {
    return { ok: false, error: "Cannot merge an incident into itself", status: 400 };
  }

  const [source, target] = await Promise.all([
    prisma.incident.findFirst({
      where: { id: sourceIncidentId, Project: { organizationId } },
      include: { IncidentAlert: { select: { alertId: true } } }
    }),
    prisma.incident.findFirst({
      where: { id: targetIncidentId, Project: { organizationId }, mergedIntoIncidentId: null }
    })
  ]);

  if (!source || !target) {
    return { ok: false, error: "Incident not found", status: 404 };
  }
  if (source.mergedIntoIncidentId) {
    return { ok: false, error: "Source incident already merged", status: 409 };
  }
  if (source.projectId !== target.projectId) {
    return { ok: false, error: "Incidents must share a project to merge", status: 400 };
  }

  const existingLinks = await prisma.incidentAlert.findMany({
    where: { incidentId: target.id },
    select: { alertId: true }
  });
  const existingAlertIds = new Set(existingLinks.map((row) => row.alertId));
  const toLink = source.IncidentAlert.filter((row) => !existingAlertIds.has(row.alertId));

  await prisma.$transaction(async (tx) => {
    if (toLink.length > 0) {
      await tx.incidentAlert.createMany({
        data: toLink.map((row) => ({ incidentId: target.id, alertId: row.alertId })),
        skipDuplicates: true
      });
    }
    await tx.incident.update({
      where: { id: source.id },
      data: {
        mergedIntoIncidentId: target.id,
        status: "RESOLVED",
        resolvedAt: source.resolvedAt ?? new Date(),
        resolutionNotes: `Merged into ${target.id}`
      }
    });
    await tx.incidentTimelineEvent.create({
      data: {
        id: randomUUID(),
        incidentId: target.id,
        projectId: target.projectId,
        eventType: "INCIDENT_MERGED",
        summary: `Merged incident ${source.id} into this incident`,
        sourceType: "INCIDENT",
        sourceId: source.id,
        occurredAt: new Date(),
        payloadJson: { sourceIncidentId: source.id, sourceTitle: source.title }
      }
    });
  });

  return { ok: true };
};

export const reopenIncident = async (
  organizationId: string,
  incidentId: string
): Promise<{ ok: true } | { ok: false; error: string; status: number }> => {
  const incident = await prisma.incident.findFirst({
    where: { id: incidentId, Project: { organizationId } }
  });
  if (!incident) {
    return { ok: false, error: "Incident not found", status: 404 };
  }
  if (incident.mergedIntoIncidentId) {
    return { ok: false, error: "Merged incidents cannot be reopened; reopen the target instead", status: 409 };
  }
  if (incident.status !== "RESOLVED") {
    return { ok: false, error: "Only resolved incidents can be reopened", status: 400 };
  }

  const gate = canReopenIncident({ resolvedAt: incident.resolvedAt });
  if (!gate.allowed) {
    return { ok: false, error: gate.reason, status: 429 };
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.incident.update({
      where: { id: incident.id },
      data: {
        status: "OPEN",
        resolvedAt: null,
        resolutionNotes: null,
        reopenCount: incident.reopenCount + 1,
        lastReopenedAt: now
      }
    });
    await tx.incidentTimelineEvent.create({
      data: {
        id: randomUUID(),
        incidentId: incident.id,
        projectId: incident.projectId,
        eventType: "INCIDENT_REOPENED",
        summary: `Incident reopened (count ${incident.reopenCount + 1})`,
        sourceType: "INCIDENT",
        sourceId: incident.id,
        occurredAt: now
      }
    });
  });

  return { ok: true };
};
