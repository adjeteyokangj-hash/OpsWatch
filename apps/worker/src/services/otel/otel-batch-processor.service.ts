// Compatibility export only. OTEL processing is implemented once by the API
// package and is consumed by both synchronous ingest and worker scheduling.
export {
  processOtelBatch,
  processPendingOtelBatches
} from "@opswatch/api/otel-process";
