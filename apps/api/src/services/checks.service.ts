import { prisma } from "../lib/prisma";
import { AlertStatus } from "@prisma/client";
import type {
  AlertListItemDto,
  AlertDetailDto,
  CheckListItemDto,
  CheckStatusSummaryDto,
  CheckListResponseDto,
  CheckDetailDto,
  CheckResultDto
} from "../types/dto";
import { loadLatestCheckResultsByCheckIds } from "./check-result-batch.service";

type AlertListFilters = {
  projectId?: string;
  serviceId?: string;
  severity?: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status?: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  q?: string;
  onlyOpen?: boolean;
  onlyUnresolved?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
};

export const listAlerts = async (organizationId: string, filters: AlertListFilters = {}) => {
  const unresolvedStatuses: AlertStatus[] = ["OPEN", "ACKNOWLEDGED"];

  const where = {
    Project: {
      organizationId,
      ...(filters.projectId ? { id: filters.projectId } : {})
    },
    ...(filters.serviceId ? { serviceId: filters.serviceId } : {}),
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
            { message: { contains: filters.q, mode: "insensitive" as const } }
          ]
        }
      : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          lastSeenAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {})
          }
        }
      : {})
  };

  const rows = await prisma.alert.findMany({
    where,
    include: {
      Project: true,
      Service: true,
      User: { select: { id: true, name: true, email: true } },
      IncidentAlert: {
        include: {
          Incident: { select: { id: true, title: true, status: true } }
        },
        take: 5
      }
    },
    orderBy: { lastSeenAt: "desc" }
  });

  return rows.map((r): AlertListItemDto => ({
    id: r.id,
    title: r.title,
    message: r.message,
    severity: r.severity,
    status: r.status,
    category: r.category,
    sourceType: r.sourceType,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    project: { id: r.Project.id, name: r.Project.name },
    service: r.Service ? { id: r.Service.id, name: r.Service.name } : null,
    linkedIncidents: r.IncidentAlert.map((link) => ({
      id: link.Incident.id,
      title: link.Incident.title,
      status: link.Incident.status
    })),
    assignedTo: r.User
      ? { id: r.User.id, name: r.User.name, email: r.User.email }
      : null
  }));
};

type AlertDetailRecord = Awaited<ReturnType<typeof prisma.alert.findUnique>> & {
  Project: { id: string; name: string; organizationId: string | null };
  Service: { id: string; name: string } | null;
  User: { id: string; name: string; email: string } | null;
  IncidentAlert: Array<{
    Incident: {
      id: string;
      title: string;
      severity: string;
      status: string;
      openedAt: Date;
    };
  }>;
  OtelAlertEvidence?: Array<{
    id: string;
    evidenceKind: string;
    summary: string;
    confidence: number | null;
    traceId: string | null;
    spanId: string | null;
    observedAt: Date;
  }>;
  LogEvidenceLink?: Array<{
    id: string;
    evidenceKind: string;
    summary: string;
    confidence: number | null;
    occurrenceGroupId: string | null;
    logRecordId: string | null;
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
    endpointWindowId: string | null;
    dependencyWindowId: string | null;
    observedAt: Date;
  }>;
};

export const mapAlertDetail = (r: NonNullable<AlertDetailRecord>): AlertDetailDto => ({
  id: r.id,
  title: r.title,
  message: r.message,
  severity: r.severity,
  status: r.status,
  category: r.category,
  sourceType: r.sourceType,
  firstSeenAt: r.firstSeenAt.toISOString(),
  lastSeenAt: r.lastSeenAt.toISOString(),
  acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
  resolvedAt: r.resolvedAt?.toISOString() ?? null,
  project: { id: r.Project.id, name: r.Project.name },
  service: r.Service ? { id: r.Service.id, name: r.Service.name } : null,
  assignedTo: r.User
    ? { id: r.User.id, name: r.User.name, email: r.User.email }
    : null,
  linkedIncidents: r.IncidentAlert.map((ref) => ({
    id: ref.Incident.id,
    title: ref.Incident.title,
    status: ref.Incident.status
  })),
  incidents: r.IncidentAlert.map((ref) => ({
    id: ref.Incident.id,
    title: ref.Incident.title,
    severity: ref.Incident.severity,
    status: ref.Incident.status,
    openedAt: ref.Incident.openedAt.toISOString()
  })),
  otelEvidence: (r.OtelAlertEvidence ?? []).map((row) => ({
    id: row.id,
    evidenceKind: row.evidenceKind,
    summary: row.summary,
    confidence: row.confidence,
    traceId: row.traceId,
    spanId: row.spanId,
    observedAt: row.observedAt.toISOString()
  })),
  logEvidence: (r.LogEvidenceLink ?? []).map((row) => ({
    id: row.id,
    evidenceKind: row.evidenceKind,
    summary: row.summary,
    confidence: row.confidence,
    occurrenceGroupId: row.occurrenceGroupId,
    logRecordId: row.logRecordId,
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
    endpointWindowId: row.endpointWindowId,
    dependencyWindowId: row.dependencyWindowId,
    observedAt: row.observedAt.toISOString()
  })),
  operationalEntityId: r.operationalEntityId ?? null,
  operationalRelationshipId: r.operationalRelationshipId ?? null
});

// ─── Checks service ──────────────────────────────────────────────────────────

export type CheckListFilters = {
  projectId?: string;
  serviceId?: string;
  latestStatus?: string;
  isActive?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
};

const mapResult = (r: {
  id: string;
  status: string;
  responseCode: number | null;
  responseTimeMs: number | null;
  message: string | null;
  checkedAt: Date;
}): CheckResultDto => ({
  id: r.id,
  status: r.status,
  responseCode: r.responseCode,
  responseTimeMs: r.responseTimeMs,
  message: r.message,
  checkedAt: r.checkedAt.toISOString()
});

export const listChecksWithSummary = async (
  organizationId: string,
  filters: CheckListFilters = {}
): Promise<CheckListResponseDto> => {
  const projectFilter = filters.projectId
    ? { id: filters.projectId, organizationId }
    : { organizationId };

  const where = {
    Service: {
      ...(filters.serviceId ? { id: filters.serviceId } : {}),
      Project: projectFilter
    },
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          updatedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {})
          }
        }
      : {})
  };

  const rows = await prisma.check.findMany({
    where,
    include: {
      Service: { include: { Project: true } }
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
  });

  const latestByCheckId = await loadLatestCheckResultsByCheckIds(rows.map((row) => row.id));

  const items: CheckListItemDto[] = rows
    .map((r) => {
      const latest = latestByCheckId.get(r.id) ?? null;
      return {
        row: r,
        dto: {
          id: r.id,
          name: r.name,
          type: r.type,
          intervalSeconds: r.intervalSeconds,
          timeoutMs: r.timeoutMs,
          isActive: r.isActive,
          service: {
            id: r.Service.id,
            name: r.Service.name,
            project: { id: r.Service.Project.id, name: r.Service.Project.name }
          },
          latestResult: latest
            ? mapResult({
                id: `${latest.checkId}:latest`,
                status: latest.status as CheckResultDto["status"],
                responseCode: latest.responseCode ?? null,
                responseTimeMs: latest.responseTimeMs,
                message: latest.message ?? null,
                checkedAt: latest.checkedAt
              })
            : null
        } satisfies CheckListItemDto
      };
    })
    .filter(({ dto }) =>
      filters.latestStatus
        ? (dto.latestResult?.status ?? "PENDING") === filters.latestStatus
        : true
    )
    .map(({ dto }) => dto);

  const summary: CheckStatusSummaryDto = {
    total: items.length,
    pass: items.filter((i) => i.latestResult?.status === "PASS").length,
    fail: items.filter((i) => i.latestResult?.status === "FAIL").length,
    warn: items.filter((i) => i.latestResult?.status === "WARN").length,
    pending: items.filter((i) => i.latestResult === null || i.latestResult.status === "PENDING")
      .length
  };

  return { items, summary };
};

export const getCheckDetail = async (
  checkId: string,
  organizationId: string
): Promise<CheckDetailDto | null> => {
  const check = await prisma.check.findFirst({
    where: { id: checkId, Service: { Project: { organizationId } } },
    include: {
      Service: { include: { Project: true } },
      CheckResult: { orderBy: { checkedAt: "desc" }, take: 1 }
    }
  });

  if (!check) return null;

  const recentRows = await prisma.checkResult.findMany({
    where: { checkId: check.id },
    orderBy: { checkedAt: "desc" },
    take: 50
  });

  const recentResults = recentRows.map(mapResult);

  const statusSummary: CheckStatusSummaryDto = {
    total: recentResults.length,
    pass: recentResults.filter((r) => r.status === "PASS").length,
    fail: recentResults.filter((r) => r.status === "FAIL").length,
    warn: recentResults.filter((r) => r.status === "WARN").length,
    pending: 0
  };

  return {
    id: check.id,
    name: check.name,
    type: check.type,
    intervalSeconds: check.intervalSeconds,
    timeoutMs: check.timeoutMs,
    expectedStatusCode: check.expectedStatusCode,
    expectedKeyword: check.expectedKeyword,
    failureThreshold: check.failureThreshold,
    recoveryThreshold: check.recoveryThreshold,
    configJson: check.configJson,
    isActive: check.isActive,
    createdAt: check.createdAt.toISOString(),
    updatedAt: check.updatedAt.toISOString(),
    service: {
      id: check.Service.id,
      name: check.Service.name,
      project: { id: check.Service.Project.id, name: check.Service.Project.name }
    },
    latestResult: check.CheckResult[0] ? mapResult(check.CheckResult[0]) : null,
    recentResults,
    statusSummary
  };
};
