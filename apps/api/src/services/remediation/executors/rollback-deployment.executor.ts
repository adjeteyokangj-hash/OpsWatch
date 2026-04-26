import type { RemediationExecutor } from "../types";
import { completed, misconfigured, failed } from "./_common";

const DEPLOYMENT_ROLLBACK_WEBHOOK_URL = process.env.DEPLOYMENT_ROLLBACK_WEBHOOK_URL;

export const executeRollbackDeployment: RemediationExecutor = async ({ context }) => {
  if (!DEPLOYMENT_ROLLBACK_WEBHOOK_URL) {
    return misconfigured("Rollback deployment is not connected to a deployment provider.", ["DEPLOYMENT_ROLLBACK_WEBHOOK_URL"]);
  }

  const response = await fetch(DEPLOYMENT_ROLLBACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: context.projectId,
      serviceId: context.serviceId,
      incidentId: context.incidentId
    })
  });

  if (!response.ok) {
    return failed(`Deployment rollback provider call failed with ${response.status}`);
  }

  return completed("Deployment rollback requested via provider webhook.");
};
