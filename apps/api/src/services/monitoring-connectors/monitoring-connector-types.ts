import type { ConnectionMode } from "../connection-manifest.service";

export const MONITORING_CONNECTOR_MODES = [
  "METRICS_ALERTS_CONNECTOR",
  "APPLICATION_PERFORMANCE_CONNECTOR",
  "INFRASTRUCTURE_MONITORING_CONNECTOR"
] as const;

export type MonitoringConnectorMode = (typeof MONITORING_CONNECTOR_MODES)[number];

export const isMonitoringConnectorMode = (mode: string): mode is MonitoringConnectorMode =>
  (MONITORING_CONNECTOR_MODES as readonly string[]).includes(mode);

export const MONITORING_CONNECTOR_DISPLAY: Record<MonitoringConnectorMode, string> = {
  METRICS_ALERTS_CONNECTOR: "Metrics & alerts connector",
  APPLICATION_PERFORMANCE_CONNECTOR: "Application performance connector",
  INFRASTRUCTURE_MONITORING_CONNECTOR: "Infrastructure monitoring connector"
};

export const MONITORING_SOURCE_PROVENANCE = "MONITORING_SOURCE";
export const MONITORING_ENTITY_SOURCE = "EXTERNAL_MONITORING";

export type MonitoringSyncStatus = "IDLE" | "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";

export type MonitoringSyncPage<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type NormalizedMonitoringEntity = {
  stableKey: string;
  name: string;
  entityType: "SERVICE" | "MONITOR" | "PROBLEM" | "METRIC" | "LOG_STREAM" | "TRACE_SERVICE";
  health?: string;
  metadata?: Record<string, unknown>;
};

export type NormalizedMonitoringSignal = {
  kind: "ALERT" | "EVENT" | "METRIC_SAMPLE" | "PROBLEM";
  externalId: string;
  title: string;
  severity?: string;
  entityStableKey?: string;
  observedAt?: string;
  metadata?: Record<string, unknown>;
};

export type MonitoringSyncResult = {
  status: MonitoringSyncStatus;
  importedCount: number;
  pageCount: number;
  durationMs: number;
  cursorEnd: string | null;
  summary: string;
  error?: string;
  errorCategory?: string;
  limitations: string[];
  entities: number;
  signals: number;
  relationships: number;
};

export type MonitoringConnectionRow = {
  id: string;
  organizationId: string;
  projectId: string | null;
  name: string;
  mode: string;
  environment: string | null | undefined;
  authMethod: string;
  configurationJson: unknown;
  credentialFamilyId?: string | null;
  secretRef: string | null;
  managedSecretCiphertext?: string | null;
  managedSecretIv?: string | null;
  managedSecretAuthTag?: string | null;
  syncIntervalMinutes?: number | null;
  lastSyncAt?: Date | null;
};

export const defaultSyncPathForMode = (mode: ConnectionMode): string => {
  switch (mode) {
    case "METRICS_ALERTS_CONNECTOR":
      return "/api/v1/sync/metrics-alerts";
    case "APPLICATION_PERFORMANCE_CONNECTOR":
      return "/api/v1/sync/application-performance";
    case "INFRASTRUCTURE_MONITORING_CONNECTOR":
      return "/api/v1/sync/infrastructure";
    default:
      return "/api/v1/sync";
  }
};
