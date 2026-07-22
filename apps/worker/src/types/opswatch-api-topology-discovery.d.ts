declare module "@opswatch/api/api-topology-discovery" {
  export function syncDueApiTopologyConnections(): Promise<{
    attempted: number;
    succeeded: number;
    failed: number;
  }>;
}
