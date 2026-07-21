/**
 * Ambient declarations for the `@opswatch/api` service subpaths the worker
 * consumes.
 *
 * The worker reuses a handful of API service functions
 * (`@opswatch/api/recovery-propagation`, `/learning-cycle`, `/monitoring-sync`,
 * `/otel-process`). At runtime Node resolves these via the API package's
 * `exports` map to its compiled `dist/*.js`. Under the worker's `tsc` build
 * (`moduleResolution: "Node"`), the `exports` map is ignored, so without a
 * declaration the imports fail to resolve.
 *
 * Rather than forcing the API to emit `.d.ts` (and coupling the worker build to
 * the API's internal types), we declare the small consumed surface here. This
 * mirrors the reverse-direction shim the API uses for `@opswatch/worker/jobs`
 * (`apps/api/src/types/opswatch-worker-jobs.d.ts`). The functions are fully
 * type-checked in the API package itself.
 */

declare module "@opswatch/api/recovery-propagation" {
  export const propagateCheckRecovery: (...args: any[]) => Promise<any>;
}

declare module "@opswatch/api/learning-cycle" {
  export const runLearningCycleForAllOrgs: (...args: any[]) => Promise<any>;
}

declare module "@opswatch/api/monitoring-sync" {
  export const syncDueMonitoringConnections: (...args: any[]) => Promise<any>;
}

declare module "@opswatch/api/otel-process" {
  export const processOtelBatch: (...args: any[]) => Promise<any>;
  export const processPendingOtelBatches: (...args: any[]) => Promise<any>;
  export const processOtelFreshness: (...args: any[]) => Promise<any>;
}
