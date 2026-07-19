import { processOtelFreshness } from "../services/otel/otel-freshness.service";

/**
 * Heartbeat stale processing must never update OTEL freshness timestamps.
 * This job is the sole writer of OTEL stale/inactive transitions.
 */
export const processOtelFreshnessJob = async (): Promise<void> => {
  if (process.env.OPSWATCH_OTEL_INGESTION_ENABLED !== "true") return;
  await processOtelFreshness();
};
