/**
 * Private wire-format adapter for application-performance monitoring sources.
 * Vendor host strings and field names stay in this file only.
 * Public OpsWatch surfaces must continue to use APPLICATION_PERFORMANCE_CONNECTOR.
 */
import type {
  MonitoringSyncPage,
  NormalizedMonitoringEntity,
  NormalizedMonitoringSignal
} from "../monitoring-connector-types";

const _WIRE_API_HOSTS = ["{environmentId}.live.dynatrace.com", "api.dynatrace.com"] as const;
void _WIRE_API_HOSTS;

type WireEntity = {
  entityId?: string;
  displayName?: string;
  type?: string;
  properties?: Record<string, unknown>;
};

type WireProblem = {
  problemId?: string;
  displayId?: string;
  title?: string;
  severityLevel?: string;
  status?: string;
  impactedEntities?: Array<{ entityId?: string; name?: string }>;
  startTime?: number;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const mapEntityType = (type?: string): NormalizedMonitoringEntity["entityType"] => {
  const normalized = String(type ?? "").toUpperCase();
  if (normalized.includes("SERVICE")) return "TRACE_SERVICE";
  if (normalized.includes("PROCESS") || normalized.includes("HOST")) return "SERVICE";
  return "TRACE_SERVICE";
};

const mapSeverity = (level?: string): string => {
  const normalized = String(level ?? "").toUpperCase();
  if (normalized.includes("AVAILABILITY") || normalized === "CRITICAL") return "CRITICAL";
  if (normalized.includes("ERROR")) return "HIGH";
  if (normalized.includes("RESOURCE") || normalized.includes("PERFORMANCE")) return "MEDIUM";
  return "MEDIUM";
};

export const isApplicationPerformanceWirePayload = (payload: unknown): boolean => {
  const body = asRecord(payload);
  if (!body) return false;
  return Array.isArray(body.entities) && (body.totalCount != null || Array.isArray(body.problems));
};

export const adaptApplicationPerformanceWirePage = (
  payload: unknown
): MonitoringSyncPage<{ entities: NormalizedMonitoringEntity[]; signals: NormalizedMonitoringSignal[] }> => {
  const body = asRecord(payload) ?? {};
  const entitiesRaw = Array.isArray(body.entities) ? (body.entities as WireEntity[]) : [];
  const problemsRaw = Array.isArray(body.problems) ? (body.problems as WireProblem[]) : [];

  const entities: NormalizedMonitoringEntity[] = [];
  for (const entity of entitiesRaw) {
    const id = entity.entityId?.trim();
    const name = entity.displayName?.trim();
    if (!id || !name) continue;
    entities.push({
      stableKey: id,
      name,
      entityType: mapEntityType(entity.type),
      health: "UNKNOWN",
      metadata: {
        wireShape: "application_performance_v1",
        entityTypeRaw: entity.type ?? null,
        properties: entity.properties ?? {}
      }
    });
  }

  const signals: NormalizedMonitoringSignal[] = [];
  for (const problem of problemsRaw) {
    const id = problem.problemId?.trim() || problem.displayId?.trim();
    const title = problem.title?.trim();
    if (!id || !title) continue;
    signals.push({
      kind: "PROBLEM",
      externalId: id,
      title,
      severity: mapSeverity(problem.severityLevel),
      entityStableKey: problem.impactedEntities?.[0]?.entityId,
      observedAt: problem.startTime ? new Date(problem.startTime).toISOString() : undefined,
      metadata: {
        wireShape: "application_performance_v1",
        status: problem.status ?? null,
        impactedEntities: problem.impactedEntities ?? []
      }
    });
  }

  const nextCursor =
    (typeof body.nextPageKey === "string" && body.nextPageKey) ||
    (typeof body.nextPageKey === "number" ? String(body.nextPageKey) : null);

  return {
    items: [{ entities, signals }],
    nextCursor,
    hasMore: Boolean(nextCursor)
  };
};
