import { syncDueMonitoringConnections } from "@opswatch/api/monitoring-sync";

/**
 * Phase 10 monitoring source synchronization.
 * Uses provider-neutral connector modes only.
 */
export const runMonitoringSyncJob = async (): Promise<void> => {
  if (process.env.WORKER_MONITORING_SYNC_ENABLED === "false") {
    return;
  }
  await syncDueMonitoringConnections();
};
