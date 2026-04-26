import type { RemediationExecutor } from "../types";
import { completed, misconfigured, failed } from "./_common";

const SERVICE_RESTART_WEBHOOK_URL = process.env.SERVICE_RESTART_WEBHOOK_URL;

export const executeRestartService: RemediationExecutor = async ({ context }) => {
  if (!SERVICE_RESTART_WEBHOOK_URL) {
    return misconfigured("Service restart is not configured.", ["SERVICE_RESTART_WEBHOOK_URL"]);
  }

  const response = await fetch(SERVICE_RESTART_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: context.projectId,
      serviceId: context.serviceId,
      incidentId: context.incidentId
    })
  });

  if (!response.ok) {
    return failed(`Service restart provider call failed with ${response.status}`);
  }

  return completed("Service restart requested via provider webhook.");
};
