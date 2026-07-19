import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { isLogsExplorerEnabled, LOG_QUERY_MAX_RESULTS } from "./logs-apm-feature-flags";

export type LogQueryInput = {
  organizationId: string;
  projectId: string;
  environment?: string;
  entityId?: string;
  serviceName?: string;
  severity?: string;
  source?: string;
  provider?: string;
  text?: string;
  traceId?: string;
  spanId?: string;
  correlationId?: string;
  fingerprint?: string;
  occurrenceGroupId?: string;
  relatedAlertId?: string;
  relatedIncidentId?: string;
  attributeKey?: string;
  attributeValue?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
  sort?: "asc" | "desc";
};

const clampLimit = (limit: number | undefined): number => {
  const max = LOG_QUERY_MAX_RESULTS();
  if (!limit || !Number.isFinite(limit) || limit <= 0) return Math.min(50, max);
  return Math.min(Math.floor(limit), max);
};

export const queryLogRecords = async (input: LogQueryInput) => {
  if (!isLogsExplorerEnabled()) {
    return {
      state: "FEATURE_DISABLED" as const,
      message: "Logs explorer is disabled (OPSWATCH_LOGS_EXPLORER_ENABLED).",
      items: [],
      nextCursor: null
    };
  }

  const limit = clampLimit(input.limit);
  const sort = input.sort === "asc" ? "asc" : "desc";
  const where: Prisma.LogRecordWhereInput = {
    organizationId: input.organizationId,
    projectId: input.projectId
  };

  if (input.environment) where.environment = input.environment;
  if (input.entityId) where.entityId = input.entityId;
  if (input.serviceName) where.serviceName = input.serviceName;
  if (input.severity) where.severity = input.severity.toUpperCase();
  if (input.source) where.source = input.source;
  if (input.provider) where.provider = input.provider;
  if (input.traceId) where.traceId = input.traceId;
  if (input.spanId) where.spanId = input.spanId;
  if (input.correlationId) where.correlationId = input.correlationId;
  if (input.fingerprint) where.fingerprint = input.fingerprint;
  if (input.occurrenceGroupId) where.occurrenceGroupId = input.occurrenceGroupId;
  if (input.from || input.to) {
    where.timestamp = {
      ...(input.from ? { gte: input.from } : {}),
      ...(input.to ? { lte: input.to } : {})
    };
  }
  if (input.text) {
    const safe = input.text.slice(0, 200);
    where.body = { contains: safe, mode: "insensitive" };
  }
  if (input.relatedAlertId || input.relatedIncidentId) {
    where.EvidenceLinks = {
      some: {
        organizationId: input.organizationId,
        ...(input.relatedAlertId ? { alertId: input.relatedAlertId } : {}),
        ...(input.relatedIncidentId ? { incidentId: input.relatedIncidentId } : {})
      }
    };
  }
  if (input.cursor) {
    where.id = sort === "desc" ? { lt: input.cursor } : { gt: input.cursor };
  }

  const items = await prisma.logRecord.findMany({
    where,
    orderBy: [{ timestamp: sort }, { id: sort }],
    take: limit,
    select: {
      id: true,
      timestamp: true,
      receivedAt: true,
      severity: true,
      serviceName: true,
      environment: true,
      body: true,
      fingerprint: true,
      occurrenceGroupId: true,
      traceId: true,
      spanId: true,
      correlationId: true,
      entityId: true,
      redactionStatus: true,
      source: true,
      provider: true,
      OccurrenceGroup: {
        select: { occurrenceCount: true, status: true }
      },
      EvidenceLinks: {
        select: { alertId: true, incidentId: true },
        take: 5
      }
    }
  });

  // Attribute filter is applied in-memory on the bounded page to avoid raw SQL.
  const filtered =
    input.attributeKey && input.attributeValue
      ? items.filter((row) => {
          // attributes are not in select — re-query would be heavy; skip unless needed
          return true;
        })
      : items;

  if (input.attributeKey && input.attributeValue) {
    const withAttrs = await prisma.logRecord.findMany({
      where: { id: { in: filtered.map((r) => r.id) } },
      select: { id: true, attributesJson: true }
    });
    const allowed = new Set(
      withAttrs
        .filter((row) => {
          const attrs = (row.attributesJson ?? {}) as Record<string, unknown>;
          return String(attrs[input.attributeKey!] ?? "") === input.attributeValue;
        })
        .map((row) => row.id)
    );
    const nextItems = filtered.filter((row) => allowed.has(row.id));
    return {
      state: "OK" as const,
      items: nextItems.map(mapLogRow),
      nextCursor: nextItems.length === limit ? nextItems[nextItems.length - 1]?.id ?? null : null
    };
  }

  return {
    state: "OK" as const,
    items: filtered.map(mapLogRow),
    nextCursor: filtered.length === limit ? filtered[filtered.length - 1]?.id ?? null : null
  };
};

const mapLogRow = (row: {
  id: string;
  timestamp: Date;
  receivedAt: Date;
  severity: string | null;
  serviceName: string | null;
  environment: string;
  body: string | null;
  fingerprint: string;
  occurrenceGroupId: string | null;
  traceId: string | null;
  spanId: string | null;
  correlationId: string | null;
  entityId: string | null;
  redactionStatus: string;
  source: string;
  provider: string;
  OccurrenceGroup: { occurrenceCount: number; status: string } | null;
  EvidenceLinks: Array<{ alertId: string | null; incidentId: string | null }>;
}) => ({
  id: row.id,
  timestamp: row.timestamp.toISOString(),
  receivedAt: row.receivedAt.toISOString(),
  severity: row.severity,
  serviceName: row.serviceName,
  environment: row.environment,
  message: row.body ? row.body.slice(0, 240) : null,
  fingerprint: row.fingerprint,
  occurrenceGroupId: row.occurrenceGroupId,
  occurrenceCount: row.OccurrenceGroup?.occurrenceCount ?? 1,
  groupStatus: row.OccurrenceGroup?.status ?? null,
  traceId: row.traceId,
  spanId: row.spanId,
  correlationId: row.correlationId,
  entityId: row.entityId,
  redactionStatus: row.redactionStatus,
  source: row.source,
  provider: row.provider,
  hasTrace: Boolean(row.traceId),
  relatedAlertIds: [
    ...new Set(row.EvidenceLinks.map((l) => l.alertId).filter(Boolean) as string[])
  ],
  relatedIncidentIds: [
    ...new Set(row.EvidenceLinks.map((l) => l.incidentId).filter(Boolean) as string[])
  ]
});

export const getLogRecordById = async (input: {
  organizationId: string;
  projectId: string;
  logId: string;
}) => {
  if (!isLogsExplorerEnabled()) {
    return { state: "FEATURE_DISABLED" as const, log: null };
  }
  const log = await prisma.logRecord.findFirst({
    where: {
      id: input.logId,
      organizationId: input.organizationId,
      projectId: input.projectId
    },
    include: {
      OccurrenceGroup: true,
      EvidenceLinks: { take: 20 }
    }
  });
  if (!log) return { state: "NOT_FOUND" as const, log: null };
  return {
    state: "OK" as const,
    log: {
      ...log,
      timestamp: log.timestamp.toISOString(),
      receivedAt: log.receivedAt.toISOString(),
      retentionExpiresAt: log.retentionExpiresAt.toISOString()
    }
  };
};

export const queryLogGroups = async (input: {
  organizationId: string;
  projectId: string;
  environment?: string;
  status?: string;
  limit?: number;
}) => {
  if (!isLogsExplorerEnabled()) {
    return { state: "FEATURE_DISABLED" as const, items: [] };
  }
  const items = await prisma.logOccurrenceGroup.findMany({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      ...(input.environment ? { environment: input.environment } : {}),
      ...(input.status ? { status: input.status } : {})
    },
    orderBy: { lastSeenAt: "desc" },
    take: clampLimit(input.limit)
  });
  return { state: "OK" as const, items };
};
