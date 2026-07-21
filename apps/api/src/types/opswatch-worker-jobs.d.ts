/**
 * Ambient declaration for the worker's side-effect-free job entrypoint.
 *
 * `@opswatch/worker` depends on `@opswatch/api` (compiled dist subpaths), so a
 * static compile-time dependency from the API back onto the worker would create
 * a `tsc` build-order cycle. The serverless tick loads the jobs via a runtime
 * `import("@opswatch/worker/jobs")`; this declaration provides the types without
 * forcing the API build to depend on the worker's emitted `.d.ts` files.
 *
 * The package's `exports["./jobs"]` map resolves the real module at runtime
 * (Node / tsx / vitest all honour `exports`). With `moduleResolution: "Node"`,
 * `tsc` ignores `exports` and uses this ambient declaration instead.
 */
declare module "@opswatch/worker/jobs" {
  export type CheckJobOptions = { projectId?: string; checkIds?: string[] };

  export const runHttpChecksJob: (options?: CheckJobOptions) => Promise<void>;
  export const runSslChecksJob: (options?: CheckJobOptions) => Promise<void>;
  export const processHeartbeatStaleJob: () => Promise<void>;
  export const processAlertEscalationJob: () => Promise<void>;
  export const resolveIncidentsJob: () => Promise<void>;
  export const runIncidentCorrelationJob: () => Promise<void>;
  export const evaluateSloBurnRateJob: () => Promise<void>;
  export const runIncidentAutoHealJob: () => Promise<void>;
  export const runAutomationAutonomousJob: () => Promise<void>;
  export const runMaintenanceWindowTransitionsJob: () => Promise<void>;
  export const pruneRetentionJob: () => Promise<void>;
  export const runExpireCredentialsJob: () => Promise<void>;
  export const processOtelBatchesJob: () => Promise<void>;
  export const processOtelFreshnessJob: () => Promise<void>;
  export const runLearningCycleJob: () => Promise<void>;
  export const runMonitoringSyncJob: () => Promise<void>;
}
