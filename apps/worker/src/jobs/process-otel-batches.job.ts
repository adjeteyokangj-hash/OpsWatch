import { processPendingOtelBatches } from "../services/otel/otel-batch-processor.service";

export const processOtelBatchesJob = async (): Promise<void> => {
  if (process.env.OPSWATCH_OTEL_INGESTION_ENABLED !== "true") return;
  await processPendingOtelBatches();
};
