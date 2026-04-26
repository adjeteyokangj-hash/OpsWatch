import type { RemediationExecutor } from "../types";
import { completed, misconfigured, failed } from "./_common";

const WORKER_RESTART_WEBHOOK_URL = process.env.WORKER_RESTART_WEBHOOK_URL;

export const executeRestartWorker: RemediationExecutor = async ({ context }) => {
  if (!WORKER_RESTART_WEBHOOK_URL) {
    return misconfigured("Worker restart is not configured.", ["WORKER_RESTART_WEBHOOK_URL"]);
  }

  const response = await fetch(WORKER_RESTART_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: context.projectId,
      serviceId: context.serviceId,
      incidentId: context.incidentId
    })
  });

  if (!response.ok) {
    return failed(`Worker restart provider call failed with ${response.status}`);
  }

  return completed("Worker restart requested via provider webhook.");
};
