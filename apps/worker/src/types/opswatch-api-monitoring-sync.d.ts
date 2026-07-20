declare module "@opswatch/api/monitoring-sync" {
  export const syncDueMonitoringConnections: () => Promise<{ attempted: number; succeeded: number }>;
}
