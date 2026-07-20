import type { MonitoringConnectorMode } from "./monitoring-connector-types";

/**
 * Internal adapter profiles. Vendor-specific API hosts remain server-side only.
 * Public DTOs must never expose profile keys or vendor branding.
 */
export type MonitoringSourceProfileKey = "METRICS_ALERTS_V1" | "APPLICATION_PERFORMANCE_V1" | "INFRASTRUCTURE_V1";

export type MonitoringSourceProfile = {
  key: MonitoringSourceProfileKey;
  mode: MonitoringConnectorMode;
  defaultHealthPath: string;
  defaultSyncPath: string;
  cursorParam: string;
  pageSizeParam: string;
  defaultPageSize: number;
  limitations: string[];
};

const profiles: Record<MonitoringSourceProfileKey, MonitoringSourceProfile> = {
  METRICS_ALERTS_V1: {
    key: "METRICS_ALERTS_V1",
    mode: "METRICS_ALERTS_CONNECTOR",
    defaultHealthPath: "/api/v1/validate",
    defaultSyncPath: "/api/v1/sync/metrics-alerts",
    cursorParam: "cursor",
    pageSizeParam: "page_size",
    defaultPageSize: 100,
    limitations: [
      "Log and trace payloads may be unavailable depending on monitoring source permissions.",
      "Historical metric backfill depth depends on source retention settings."
    ]
  },
  APPLICATION_PERFORMANCE_V1: {
    key: "APPLICATION_PERFORMANCE_V1",
    mode: "APPLICATION_PERFORMANCE_CONNECTOR",
    defaultHealthPath: "/api/v1/validate",
    defaultSyncPath: "/api/v1/sync/application-performance",
    cursorParam: "nextPageKey",
    pageSizeParam: "pageSize",
    defaultPageSize: 50,
    limitations: [
      "Full distributed trace detail may require additional source entitlements.",
      "Service dependency inference is evidence-based and may be incomplete."
    ]
  },
  INFRASTRUCTURE_V1: {
    key: "INFRASTRUCTURE_V1",
    mode: "INFRASTRUCTURE_MONITORING_CONNECTOR",
    defaultHealthPath: "/api/v1/validate",
    defaultSyncPath: "/api/v1/sync/infrastructure",
    cursorParam: "cursor",
    pageSizeParam: "limit",
    defaultPageSize: 100,
    limitations: [
      "Host-level inventory may be omitted when the source API does not expose infrastructure entities.",
      "Problem correlation uses imported evidence only; no breach certainty is implied."
    ]
  }
};

export const resolveMonitoringProfile = (
  mode: MonitoringConnectorMode,
  configuration: Record<string, unknown>
): MonitoringSourceProfile => {
  const configured = typeof configuration.sourceProfile === "string"
    ? configuration.sourceProfile.toUpperCase()
    : null;
  if (configured && configured in profiles) {
    return profiles[configured as MonitoringSourceProfileKey];
  }
  if (mode === "METRICS_ALERTS_CONNECTOR") return profiles.METRICS_ALERTS_V1;
  if (mode === "APPLICATION_PERFORMANCE_CONNECTOR") return profiles.APPLICATION_PERFORMANCE_V1;
  return profiles.INFRASTRUCTURE_V1;
};

export const listMonitoringProfileLimitations = (mode: MonitoringConnectorMode): string[] =>
  resolveMonitoringProfile(mode, {}).limitations;
