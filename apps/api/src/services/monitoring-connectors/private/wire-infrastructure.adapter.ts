/**
 * Private wire-format adapter for infrastructure monitoring sources.
 * Vendor host strings and field names stay in this file only.
 * Public OpsWatch surfaces must continue to use INFRASTRUCTURE_MONITORING_CONNECTOR.
 */
import type {
  MonitoringSyncPage,
  NormalizedMonitoringEntity,
  NormalizedMonitoringSignal
} from "../monitoring-connector-types";

const _WIRE_API_HOSTS = ["api.datadoghq.com", "{environmentId}.live.dynatrace.com"] as const;
void _WIRE_API_HOSTS;

type WireHost = {
  id?: string | number;
  host_name?: string;
  name?: string;
  status?: string;
  tags?: string[];
};

type WireProblem = {
  problemId?: string;
  title?: string;
  severityLevel?: string;
  impactedEntities?: Array<{ entityId?: string }>;
  startTime?: number;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const mapHealth = (status?: string): string => {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "up" || normalized === "ok") return "HEALTHY";
  if (normalized === "down" || normalized === "critical") return "UNHEALTHY";
  return "UNKNOWN";
};

export const isInfrastructureWirePayload = (payload: unknown): boolean => {
  const body = asRecord(payload);
  if (!body) return false;
  return Array.isArray(body.hosts) || (Array.isArray(body.entities) && Array.isArray(body.problems));
};

export const adaptInfrastructureWirePage = (
  payload: unknown
): MonitoringSyncPage<{ entities: NormalizedMonitoringEntity[]; signals: NormalizedMonitoringSignal[] }> => {
  const body = asRecord(payload) ?? {};
  const hosts = Array.isArray(body.hosts) ? (body.hosts as WireHost[]) : [];
  const entitiesRaw = Array.isArray(body.entities)
    ? (body.entities as Array<{ entityId?: string; displayName?: string; type?: string }>)
    : [];
  const problems = Array.isArray(body.problems) ? (body.problems as WireProblem[]) : [];

  const entities: NormalizedMonitoringEntity[] = [];
  for (const host of hosts) {
    const id = host.id != null ? String(host.id) : null;
    const name = host.host_name?.trim() || host.name?.trim();
    if (!id || !name) continue;
    entities.push({
      stableKey: `host:${id}`,
      name,
      entityType: "SERVICE",
      health: mapHealth(host.status),
      metadata: { wireShape: "infrastructure_v1", tags: host.tags ?? [] }
    });
  }
  for (const entity of entitiesRaw) {
    const id = entity.entityId?.trim();
    const name = entity.displayName?.trim();
    if (!id || !name) continue;
    entities.push({
      stableKey: id,
      name,
      entityType: "SERVICE",
      health: "UNKNOWN",
      metadata: { wireShape: "infrastructure_v1", entityTypeRaw: entity.type ?? null }
    });
  }

  const signals: NormalizedMonitoringSignal[] = [];
  for (const problem of problems) {
    const id = problem.problemId?.trim();
    const title = problem.title?.trim();
    if (!id || !title) continue;
    signals.push({
      kind: "PROBLEM",
      externalId: id,
      title,
      severity: problem.severityLevel ?? "MEDIUM",
      entityStableKey: problem.impactedEntities?.[0]?.entityId,
      observedAt: problem.startTime ? new Date(problem.startTime).toISOString() : undefined,
      metadata: { wireShape: "infrastructure_v1" }
    });
  }

  const nextCursor =
    (typeof body.next_cursor === "string" && body.next_cursor) ||
    (typeof body.nextPageKey === "string" && body.nextPageKey) ||
    null;

  return {
    items: [{ entities, signals }],
    nextCursor,
    hasMore: Boolean(nextCursor)
  };
};
