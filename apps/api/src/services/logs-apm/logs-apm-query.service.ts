import { prisma } from "../../lib/prisma";
import {
  getLogsApmFeatureFlags,
  isApmUiEnabled,
  isLogsExplorerEnabled
} from "./logs-apm-feature-flags";
import { getLogRecordById, queryLogGroups, queryLogRecords } from "./log-query.service";
import { getTraceEvidence } from "./trace-reconstruct.service";

export const getLogsApmConnectionState = async (input: {
  organizationId: string;
  projectId: string;
}) => {
  const flags = getLogsApmFeatureFlags();
  const connection = await prisma.connection.findFirst({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      type: "OTEL_COLLECTOR",
      isActive: true
    },
    select: {
      id: true,
      health: true,
      lastSuccessAt: true,
      installationStatus: true
    }
  });
  const logCount = await prisma.logRecord.count({
    where: { organizationId: input.organizationId, projectId: input.projectId }
  });
  const spanCount = await prisma.spanRecord.count({
    where: { organizationId: input.organizationId, projectId: input.projectId }
  });

  let connectionState: "NOT_CONNECTED" | "RECEIVING" | "PROCESSING_DISABLED" | "STALE" =
    "NOT_CONNECTED";
  if (!connection) connectionState = "NOT_CONNECTED";
  else if (!flags.logsIngestion && !flags.traceApmProcessing) connectionState = "PROCESSING_DISABLED";
  else if (connection.lastSuccessAt && Date.now() - connection.lastSuccessAt.getTime() > 30 * 60_000) {
    connectionState = "STALE";
  } else if (logCount > 0 || spanCount > 0 || connection.lastSuccessAt) connectionState = "RECEIVING";
  else connectionState = "NOT_CONNECTED";

  return {
    flags,
    connectionState,
    connection,
    logCount,
    spanCount,
    productLabel: "Foundation"
  };
};

export const searchProjectLogs = queryLogRecords;
export const getProjectLog = getLogRecordById;
export const listProjectLogGroups = queryLogGroups;
export const getProjectTrace = getTraceEvidence;

export const getApmOverview = async (input: {
  organizationId: string;
  projectId: string;
  environment?: string;
  windowSize?: string;
}) => {
  if (!isApmUiEnabled()) {
    return {
      state: "FEATURE_DISABLED" as const,
      message: "APM UI is disabled (OPSWATCH_APM_UI_ENABLED).",
      services: [],
      endpoints: [],
      dependencies: [],
      failingTraces: []
    };
  }
  const windowSize = input.windowSize ?? "5m";
  const envFilter = input.environment ? { environment: input.environment } : {};
  const services = await prisma.apmServiceWindow.findMany({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      windowSize,
      ...envFilter
    },
    orderBy: { windowEnd: "desc" },
    take: 50
  });
  // Deduplicate to latest window per service
  const latestServices = new Map<string, (typeof services)[number]>();
  for (const row of services) {
    const key = `${row.serviceName}|${row.environment}`;
    if (!latestServices.has(key)) latestServices.set(key, row);
  }
  const endpoints = await prisma.apmEndpointWindow.findMany({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      windowSize,
      ...envFilter
    },
    orderBy: { windowEnd: "desc" },
    take: 50
  });
  const dependencies = await prisma.apmDependencyWindow.findMany({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      windowSize,
      ...envFilter
    },
    orderBy: { windowEnd: "desc" },
    take: 50
  });
  const failingTraces = await prisma.traceRecord.findMany({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      status: "ERROR",
      ...(input.environment ? { environment: input.environment } : {})
    },
    orderBy: { startAt: "desc" },
    take: 20
  });
  const openIncidents = await prisma.incident.count({
    where: {
      projectId: input.projectId,
      status: { in: ["OPEN", "INVESTIGATING", "MONITORING"] }
    }
  });

  return {
    state: "OK" as const,
    productLabel: "Foundation",
    activeIncidents: openIncidents,
    services: [...latestServices.values()].map(mapServiceWindow),
    endpoints: endpoints.slice(0, 25).map(mapEndpointWindow),
    dependencies: dependencies.slice(0, 25).map(mapDependencyWindow),
    failingTraces: failingTraces.map((t) => ({
      traceId: t.traceId,
      status: t.status,
      durationMs: t.durationMs,
      isPartial: t.isPartial,
      errorCount: t.errorCount,
      startAt: t.startAt?.toISOString() ?? null,
      rootServiceName: t.rootServiceName
    }))
  };
};

const mapServiceWindow = (row: {
  id: string;
  serviceName: string;
  environment: string;
  entityId: string | null;
  requestCount: number;
  errorCount: number;
  errorRate: number;
  latencyAvgMs: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  latencyP99Ms: number | null;
  sampleCount: number;
  confidence: number;
  health: string;
  healthRule: string | null;
  lastObservedAt: Date | null;
  freshUntil: Date | null;
}) => ({
  id: row.id,
  serviceName: row.serviceName,
  environment: row.environment,
  entityId: row.entityId,
  requestCount: row.requestCount,
  throughputPerMinute: row.requestCount,
  errorCount: row.errorCount,
  errorRate: row.errorRate,
  latencyAvgMs: row.latencyAvgMs,
  latencyP50Ms: row.latencyP50Ms,
  latencyP95Ms: row.latencyP95Ms,
  latencyP99Ms: row.sampleCount >= 20 ? row.latencyP99Ms : null,
  percentileNote:
    row.sampleCount < 5
      ? "Insufficient samples for percentiles"
      : row.sampleCount < 20
        ? "p99 withheld — insufficient samples"
        : null,
  sampleCount: row.sampleCount,
  confidence: row.confidence,
  health: row.health,
  healthRule: row.healthRule,
  lastObservedAt: row.lastObservedAt?.toISOString() ?? null,
  freshUntil: row.freshUntil?.toISOString() ?? null,
  freshness:
    row.freshUntil && row.freshUntil.getTime() < Date.now() ? "STALE" : "FRESH"
});

const mapEndpointWindow = (row: {
  id: string;
  serviceName: string;
  operation: string;
  httpMethod: string | null;
  requestCount: number;
  errorRate: number;
  latencyP95Ms: number | null;
  slowRequestCount: number;
  failingTraceCount: number;
  sampleCount: number;
  health: string;
  lastObservedAt: Date | null;
}) => ({
  id: row.id,
  serviceName: row.serviceName,
  operation: row.operation,
  httpMethod: row.httpMethod,
  requestCount: row.requestCount,
  errorRate: row.errorRate,
  latencyP95Ms: row.sampleCount >= 5 ? row.latencyP95Ms : null,
  slowRequestCount: row.slowRequestCount,
  failingTraceCount: row.failingTraceCount,
  sampleCount: row.sampleCount,
  health: row.health,
  lastObservedAt: row.lastObservedAt?.toISOString() ?? null,
  percentileNote: row.sampleCount < 5 ? "Insufficient samples for percentiles" : null
});

const mapDependencyWindow = (row: {
  id: string;
  sourceServiceName: string;
  targetServiceName: string;
  relationshipId: string | null;
  requestCount: number;
  errorRate: number;
  timeoutRate: number;
  latencyP95Ms: number | null;
  sampleCount: number;
  health: string;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastObservedAt: Date | null;
  freshUntil: Date | null;
}) => ({
  id: row.id,
  sourceServiceName: row.sourceServiceName,
  targetServiceName: row.targetServiceName,
  relationshipId: row.relationshipId,
  requestCount: row.requestCount,
  errorRate: row.errorRate,
  timeoutRate: row.timeoutRate,
  latencyP95Ms: row.sampleCount >= 5 ? row.latencyP95Ms : null,
  sampleCount: row.sampleCount,
  health: row.health,
  lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
  lastFailureAt: row.lastFailureAt?.toISOString() ?? null,
  lastObservedAt: row.lastObservedAt?.toISOString() ?? null,
  freshness:
    row.freshUntil && row.freshUntil.getTime() < Date.now() ? "STALE" : "FRESH",
  percentileNote: row.sampleCount < 5 ? "Insufficient samples for percentiles" : null
});

export const logsExplorerAvailable = isLogsExplorerEnabled;
export const apmUiAvailable = isApmUiEnabled;
