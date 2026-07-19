/** Phase 6 Logs / APM feature flags — all default OFF. */
export const isLogsIngestionEnabled = (): boolean =>
  process.env.OPSWATCH_LOGS_INGESTION_ENABLED === "true";

export const isLogsExplorerEnabled = (): boolean =>
  process.env.OPSWATCH_LOGS_EXPLORER_ENABLED === "true";

export const isTraceApmProcessingEnabled = (): boolean =>
  process.env.OPSWATCH_TRACE_APM_PROCESSING_ENABLED === "true";

export const isApmUiEnabled = (): boolean =>
  process.env.OPSWATCH_APM_UI_ENABLED === "true";

export type LogsApmFeatureFlags = {
  logsIngestion: boolean;
  logsExplorer: boolean;
  traceApmProcessing: boolean;
  apmUi: boolean;
};

export const getLogsApmFeatureFlags = (): LogsApmFeatureFlags => ({
  logsIngestion: isLogsIngestionEnabled(),
  logsExplorer: isLogsExplorerEnabled(),
  traceApmProcessing: isTraceApmProcessingEnabled(),
  apmUi: isApmUiEnabled()
});

/** High-frequency metric freshness window (~10 minutes). */
export const APM_METRIC_FRESH_MS = (): number =>
  Number(process.env.OPSWATCH_APM_METRIC_FRESH_MS ?? 10 * 60_000);

/** Span/trace freshness window (~15 minutes). */
export const APM_SPAN_FRESH_MS = (): number =>
  Number(process.env.OPSWATCH_APM_SPAN_FRESH_MS ?? 15 * 60_000);

export const LOG_GROUPING_WINDOW_MS = (): number =>
  Number(process.env.OPSWATCH_LOG_GROUPING_WINDOW_MS ?? 15 * 60_000);

export const LOG_QUERY_MAX_RESULTS = (): number => {
  const configured = Number(process.env.OPSWATCH_LOG_QUERY_MAX_RESULTS ?? 100);
  return Number.isInteger(configured) && configured > 0 ? Math.min(configured, 500) : 100;
};

export const DEFAULT_TELEMETRY_RETENTION_DAYS = (): number => {
  const configured = Number(process.env.OPSWATCH_TELEMETRY_RETENTION_DAYS ?? 14);
  return Number.isInteger(configured) && configured > 0 ? Math.min(configured, 90) : 14;
};

export const MIN_SAMPLES_FOR_P95 = 5;
export const MIN_SAMPLES_FOR_P99 = 20;
export const MIN_SAMPLES_FOR_HEALTH = 3;
