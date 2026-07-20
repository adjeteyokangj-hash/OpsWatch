/**
 * Public adapter dispatcher. Selects private wire parsers without exposing vendor branding.
 */
import type { MonitoringConnectorMode, MonitoringSyncPage, NormalizedMonitoringEntity, NormalizedMonitoringSignal } from "./monitoring-connector-types";
import { parseMonitoringSyncPage } from "./monitoring-connector-normalize";
import {
  adaptApplicationPerformanceWirePage,
  isApplicationPerformanceWirePayload
} from "./private/wire-application-performance.adapter";
import {
  adaptInfrastructureWirePage,
  isInfrastructureWirePayload
} from "./private/wire-infrastructure.adapter";
import {
  adaptMetricsAlertsWirePage,
  isMetricsAlertsWirePayload
} from "./private/wire-metrics-alerts.adapter";

export type AdaptedSyncPage = MonitoringSyncPage<{
  entities: NormalizedMonitoringEntity[];
  signals: NormalizedMonitoringSignal[];
}>;

export const adaptMonitoringSyncPayload = (
  mode: MonitoringConnectorMode,
  payload: unknown,
  cursorParam: string
): AdaptedSyncPage => {
  if (mode === "METRICS_ALERTS_CONNECTOR" && isMetricsAlertsWirePayload(payload)) {
    return adaptMetricsAlertsWirePage(payload);
  }
  if (mode === "APPLICATION_PERFORMANCE_CONNECTOR" && isApplicationPerformanceWirePayload(payload)) {
    return adaptApplicationPerformanceWirePage(payload);
  }
  if (mode === "INFRASTRUCTURE_MONITORING_CONNECTOR" && isInfrastructureWirePayload(payload)) {
    return adaptInfrastructureWirePage(payload);
  }
  // Generic neutral JSON contract fallback.
  return parseMonitoringSyncPage(mode, payload, cursorParam);
};
