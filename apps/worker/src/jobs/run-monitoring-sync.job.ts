import { syncDueMonitoringConnections } from "@opswatch/api/monitoring-sync";
import { syncDueApiTopologyConnections } from "@opswatch/api/api-topology-discovery";

/**
 * Synchronize provider-neutral monitoring sources and declared API topology manifests.
 * Each path isolates its own per-connection failures; no database migration is involved.
 */
export const runMonitoringSyncJob = async (): Promise<void> => {
  if (process.env.WORKER_MONITORING_SYNC_ENABLED === "false") {
    return;
  }
  await syncDueMonitoringConnections();
  await syncDueApiTopologyConnections();
};
