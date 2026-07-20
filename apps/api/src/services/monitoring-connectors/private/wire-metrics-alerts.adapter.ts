/**
 * Private wire-format adapter for metrics/alerts monitoring sources.
 * Vendor host strings and field names stay in this file only.
 * Public OpsWatch surfaces must continue to use METRICS_ALERTS_CONNECTOR.
 */
import type {
  MonitoringSyncPage,
  NormalizedMonitoringEntity,
  NormalizedMonitoringSignal
} from "../monitoring-connector-types";

// Unavoidable private wire hosts (never export or surface in DTOs/UI).
const _WIRE_API_HOSTS = ["api.datadoghq.com", "api.datadoghq.eu"] as const;
void _WIRE_API_HOSTS;

type WireMonitor = {
  id?: number | string;
  name?: string;
  overall_state?: string;
  type?: string;
  tags?: string[];
};

type WireEvent = {
  id?: string | number;
  title?: string;
  text?: string;
  alert_type?: string;
  date_happened?: number;
  tags?: string[];
  monitor_id?: number | string;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const mapHealth = (state?: string): string => {
  const normalized = String(state ?? "").toLowerCase();
  if (normalized === "ok" || normalized === "success") return "HEALTHY";
  if (normalized === "warn" || normalized === "warning") return "DEGRADED";
  if (normalized === "alert" || normalized === "critical") return "UNHEALTHY";
  return "UNKNOWN";
};

const mapSeverity = (alertType?: string): string => {
  const normalized = String(alertType ?? "").toLowerCase();
  if (normalized === "error" || normalized === "critical") return "CRITICAL";
  if (normalized === "warning") return "HIGH";
  if (normalized === "info") return "INFO";
  return "MEDIUM";
};

/** Detect metrics/alerts vendor wire payload (monitor list / event list). */
export const isMetricsAlertsWirePayload = (payload: unknown): boolean => {
  const body = asRecord(payload);
  if (!body) return false;
  return Array.isArray(body.monitors) || Array.isArray(body.events);
};

export const adaptMetricsAlertsWirePage = (
  payload: unknown
): MonitoringSyncPage<{ entities: NormalizedMonitoringEntity[]; signals: NormalizedMonitoringSignal[] }> => {
  const body = asRecord(payload) ?? {};
  const monitors = Array.isArray(body.monitors) ? (body.monitors as WireMonitor[]) : [];
  const events = Array.isArray(body.events) ? (body.events as WireEvent[]) : [];

  const entities: NormalizedMonitoringEntity[] = [];
  for (const monitor of monitors) {
    const id = monitor.id != null ? String(monitor.id) : null;
    const name = monitor.name?.trim();
    if (!id || !name) continue;
    entities.push({
      stableKey: `monitor:${id}`,
      name,
      entityType: "MONITOR",
      health: mapHealth(monitor.overall_state),
      metadata: {
        wireShape: "metrics_alerts_v1",
        monitorType: monitor.type ?? null,
        tags: monitor.tags ?? []
      }
    });
  }

  const signals: NormalizedMonitoringSignal[] = [];
  for (const event of events) {
    const id = event.id != null ? String(event.id) : null;
    const title = event.title?.trim() || event.text?.trim();
    if (!id || !title) continue;
    signals.push({
      kind: "ALERT",
      externalId: `event:${id}`,
      title,
      severity: mapSeverity(event.alert_type),
      entityStableKey: event.monitor_id != null ? `monitor:${event.monitor_id}` : undefined,
      observedAt: event.date_happened
        ? new Date(event.date_happened * 1000).toISOString()
        : undefined,
      metadata: {
        wireShape: "metrics_alerts_v1",
        tags: event.tags ?? []
      }
    });
  }

  const meta = asRecord(body.meta);
  const nextCursor =
    (typeof meta?.next_cursor === "string" && meta.next_cursor) ||
    (typeof body.next_cursor === "string" && body.next_cursor) ||
    null;

  return {
    items: [{ entities, signals }],
    nextCursor,
    hasMore: Boolean(nextCursor)
  };
};
