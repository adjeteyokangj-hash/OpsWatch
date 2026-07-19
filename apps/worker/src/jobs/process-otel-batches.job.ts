import { processPendingOtelBatches } from "@opswatch/api/otel-process";

export const processOtelBatchesJob = async (): Promise<void> => {
  if (process.env.OPSWATCH_OTEL_INGESTION_ENABLED !== "true") return;
  await processPendingOtelBatches();
};
