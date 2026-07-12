import { runRetentionSweep } from "../services/retention.service";

export const pruneRetentionJob = async (): Promise<void> => {
  if (process.env.WORKER_RETENTION_ENABLED === "false") {
    return;
  }

  await runRetentionSweep();
};
