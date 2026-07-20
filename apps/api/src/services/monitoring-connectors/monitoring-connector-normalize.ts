import type {
  MonitoringConnectorMode,
  MonitoringSyncPage,
  NormalizedMonitoringEntity,
  NormalizedMonitoringSignal
} from "./monitoring-connector-types";

type RawSyncPayload = {
  items?: unknown[];
  data?: unknown[];
  entities?: unknown[];
  signals?: unknown[];
  alerts?: unknown[];
  problems?: unknown[];
  nextCursor?: string | null;
  cursor?: string | null;
  nextPageKey?: string | null;
  hasMore?: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const readString = (record: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
};

const normalizeEntity = (raw: unknown, mode: MonitoringConnectorMode): NormalizedMonitoringEntity | null => {
  const record = asRecord(raw);
  if (!record) return null;
  const stableKey = readString(record, ["stableKey", "id", "externalId", "serviceId", "monitorId"]);
  const name = readString(record, ["name", "title", "displayName", "serviceName"]);
  if (!stableKey || !name) return null;
  const entityTypeRaw = readString(record, ["entityType", "type", "kind"])?.toUpperCase();
  const entityType = (
    entityTypeRaw === "MONITOR" ||
    entityTypeRaw === "PROBLEM" ||
    entityTypeRaw === "METRIC" ||
    entityTypeRaw === "LOG_STREAM" ||
    entityTypeRaw === "TRACE_SERVICE"
  ) ? entityTypeRaw : mode === "APPLICATION_PERFORMANCE_CONNECTOR" ? "TRACE_SERVICE" : "SERVICE";
  return {
    stableKey,
    name,
    entityType,
    health: readString(record, ["health", "status"]),
    metadata: record
  };
};

const normalizeSignal = (raw: unknown): NormalizedMonitoringSignal | null => {
  const record = asRecord(raw);
  if (!record) return null;
  const externalId = readString(record, ["externalId", "id", "alertId", "problemId", "eventId"]);
  const title = readString(record, ["title", "name", "message", "summary"]);
  if (!externalId || !title) return null;
  const kindRaw = readString(record, ["kind", "type", "signalType"])?.toUpperCase();
  const kind = kindRaw === "ALERT" || kindRaw === "EVENT" || kindRaw === "METRIC_SAMPLE" || kindRaw === "PROBLEM"
    ? kindRaw
    : kindRaw?.includes("PROBLEM") ? "PROBLEM" : "ALERT";
  return {
    kind,
    externalId,
    title,
    severity: readString(record, ["severity", "priority", "status"]),
    entityStableKey: readString(record, ["entityStableKey", "serviceId", "monitorId"]),
    observedAt: readString(record, ["observedAt", "timestamp", "startedAt"]),
    metadata: record
  };
};

export const parseMonitoringSyncPage = (
  mode: MonitoringConnectorMode,
  payload: unknown,
  cursorParam: string
): MonitoringSyncPage<{ entities: NormalizedMonitoringEntity[]; signals: NormalizedMonitoringSignal[] }> => {
  const body = asRecord(payload) ?? {};
  const rawItems = Array.isArray(body.items)
    ? body.items
    : Array.isArray(body.data)
      ? body.data
      : [];
  const entities = (Array.isArray(body.entities) ? body.entities : rawItems)
    .map((item) => normalizeEntity(item, mode))
    .filter((item): item is NormalizedMonitoringEntity => Boolean(item));
  const signalCandidates = [
    ...(Array.isArray(body.signals) ? body.signals : []),
    ...(Array.isArray(body.alerts) ? body.alerts : []),
    ...(Array.isArray(body.problems) ? body.problems : [])
  ];
  const signals = signalCandidates
    .map((item) => normalizeSignal(item))
    .filter((item): item is NormalizedMonitoringSignal => Boolean(item));

  const nextCursor =
    readString(body, ["nextCursor", "cursor", "nextPageKey"]) ??
    readString(body, [cursorParam]) ??
    null;
  const hasMore = body.hasMore === true || Boolean(nextCursor);

  return {
    items: [{ entities, signals }],
    nextCursor,
    hasMore
  };
};
