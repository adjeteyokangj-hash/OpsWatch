import { prisma } from "../../lib/prisma";

export type TraceTreeNode = {
  spanRecordId: string;
  spanId: string;
  parentSpanId: string | null;
  operationName: string;
  serviceEntityId: string | null;
  serviceName: string | null;
  startTimestamp: string;
  endTimestamp: string | null;
  durationMs: number | null;
  status: string;
  children: TraceTreeNode[];
};

export type ReconstructedTrace = {
  traceId: string;
  isPartial: boolean;
  missingParents: string[];
  totalDurationMs: number | null;
  failingSpanId: string | null;
  status: string;
  serviceSequence: string[];
  serviceTimeMs: Record<string, number>;
  databaseContributionMs: number;
  externalContributionMs: number;
  errorPropagated: boolean;
  lateArrivalCount: number;
  tree: TraceTreeNode[];
  spans: Array<{
    id: string;
    spanId: string;
    parentSpanId: string | null;
    operationName: string;
    durationMs: number | null;
    status: string;
    httpMethod: string | null;
    httpRoute: string | null;
    httpStatusCode: number | null;
    dbSystem: string | null;
    externalPeer: string | null;
    exceptionSummary: string | null;
  }>;
};

const buildTree = (
  spans: Array<{
    id: string;
    spanId: string;
    parentSpanId: string | null;
    operationName: string;
    serviceEntityId: string | null;
    startTimestamp: Date;
    endTimestamp: Date | null;
    durationMs: number | null;
    status: string;
    serviceNameHint?: string | null;
  }>
): { tree: TraceTreeNode[]; missingParents: string[] } => {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const children = new Map<string, string[]>();
  const missingParents: string[] = [];

  for (const span of spans) {
    if (span.parentSpanId && !byId.has(span.parentSpanId)) {
      missingParents.push(span.parentSpanId);
    }
    const parent = span.parentSpanId && byId.has(span.parentSpanId) ? span.parentSpanId : "__root__";
    const list = children.get(parent) ?? [];
    list.push(span.spanId);
    children.set(parent, list);
  }

  const visit = (spanId: string): TraceTreeNode => {
    const span = byId.get(spanId)!;
    const kids = (children.get(spanId) ?? []).map(visit);
    return {
      spanRecordId: span.id,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      operationName: span.operationName,
      serviceEntityId: span.serviceEntityId,
      serviceName: span.serviceNameHint ?? null,
      startTimestamp: span.startTimestamp.toISOString(),
      endTimestamp: span.endTimestamp?.toISOString() ?? null,
      durationMs: span.durationMs,
      status: span.status,
      children: kids
    };
  };

  const roots = (children.get("__root__") ?? []).map(visit);
  return { tree: roots, missingParents: [...new Set(missingParents)] };
};

export const reconstructTrace = async (input: {
  organizationId: string;
  projectId: string | null;
  traceId: string;
  lateArrival?: boolean;
}): Promise<ReconstructedTrace | null> => {
  const spans = await prisma.spanRecord.findMany({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      traceId: input.traceId
    },
    orderBy: { startTimestamp: "asc" },
    include: {
      ServiceEntity: { select: { name: true } }
    }
  });
  if (spans.length === 0) return null;

  const enriched = spans.map((s) => ({
    ...s,
    serviceNameHint: s.ServiceEntity?.name ?? null
  }));
  const { tree, missingParents } = buildTree(enriched);
  const starts = spans.map((s) => s.startTimestamp.getTime());
  const ends = spans.map((s) => (s.endTimestamp ?? s.startTimestamp).getTime());
  const startAt = new Date(Math.min(...starts));
  const endAt = new Date(Math.max(...ends));
  const totalDurationMs = Math.max(0, endAt.getTime() - startAt.getTime());
  const failing = spans.find((s) => s.status === "ERROR" || (s.httpStatusCode ?? 0) >= 500);
  const services = [
    ...new Set(spans.map((s) => s.ServiceEntity?.name).filter(Boolean) as string[])
  ];
  const serviceTimeMs: Record<string, number> = {};
  let databaseContributionMs = 0;
  let externalContributionMs = 0;
  for (const span of spans) {
    const name = span.ServiceEntity?.name ?? "unknown";
    serviceTimeMs[name] = (serviceTimeMs[name] ?? 0) + (span.durationMs ?? 0);
    if (span.dbSystem) databaseContributionMs += span.durationMs ?? 0;
    if (span.externalPeer || span.messagingSystem) externalContributionMs += span.durationMs ?? 0;
  }
  const errorCount = spans.filter((s) => s.status === "ERROR").length;
  const isPartial = missingParents.length > 0 || !spans.some((s) => !s.parentSpanId);
  const status = failing ? "ERROR" : errorCount > 0 ? "ERROR" : "OK";

  const existing = await prisma.traceRecord.findFirst({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      traceId: input.traceId
    }
  });
  const lateArrivalCount = (existing?.lateArrivalCount ?? 0) + (input.lateArrival ? 1 : 0);
  const root = spans.find((s) => !s.parentSpanId) ?? spans[0];
  if (!root) return null;

  if (existing) {
    await prisma.traceRecord.update({
      where: { id: existing.id },
      data: {
        rootServiceName: root.ServiceEntity?.name ?? existing.rootServiceName,
        rootSpanId: root.spanId,
        startAt,
        endAt,
        durationMs: totalDurationMs,
        spanCount: spans.length,
        serviceCount: services.length,
        errorCount,
        status,
        isPartial,
        lateArrivalCount,
        failingSpanId: failing?.spanId ?? null,
        lastReconstructedAt: new Date(),
        updatedAt: new Date()
      }
    });
  }

  return {
    traceId: input.traceId,
    isPartial,
    missingParents,
    totalDurationMs,
    failingSpanId: failing?.spanId ?? null,
    status,
    serviceSequence: services,
    serviceTimeMs,
    databaseContributionMs,
    externalContributionMs,
    errorPropagated: Boolean(failing),
    lateArrivalCount,
    tree,
    spans: spans.map((s) => ({
      id: s.id,
      spanId: s.spanId,
      parentSpanId: s.parentSpanId,
      operationName: s.operationName,
      durationMs: s.durationMs,
      status: s.status,
      httpMethod: s.httpMethod,
      httpRoute: s.httpRoute,
      httpStatusCode: s.httpStatusCode,
      dbSystem: s.dbSystem,
      externalPeer: s.externalPeer,
      exceptionSummary: s.exceptionSummary
    }))
  };
};

export const getTraceEvidence = async (input: {
  organizationId: string;
  projectId: string;
  traceId: string;
}) => {
  const reconstructed = await reconstructTrace({
    organizationId: input.organizationId,
    projectId: input.projectId,
    traceId: input.traceId
  });
  if (!reconstructed) return null;
  const relatedLogs = await prisma.logRecord.findMany({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      traceId: input.traceId
    },
    orderBy: { timestamp: "asc" },
    take: 50,
    select: {
      id: true,
      timestamp: true,
      severity: true,
      serviceName: true,
      body: true,
      fingerprint: true
    }
  });
  const spanLinks = await prisma.spanEvidenceLink.findMany({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      traceId: input.traceId
    },
    take: 20
  });
  return {
    ...reconstructed,
    warning: reconstructed.isPartial
      ? "Partial or incomplete trace — do not treat as a complete distributed trace."
      : null,
    relatedLogs: relatedLogs.map((l) => ({
      ...l,
      timestamp: l.timestamp.toISOString(),
      message: l.body?.slice(0, 200) ?? null,
      body: undefined
    })),
    relatedAlertIds: [
      ...new Set(spanLinks.map((l) => l.alertId).filter(Boolean) as string[])
    ],
    relatedIncidentIds: [
      ...new Set(spanLinks.map((l) => l.incidentId).filter(Boolean) as string[])
    ]
  };
};
