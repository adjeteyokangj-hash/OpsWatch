import type { RemediationExecutor } from "../types";
import { completed, unsupported } from "./_common";

const JOB_REQUEUE_ENDPOINT = process.env.JOB_REQUEUE_ENDPOINT;

export const executeRequeueFailedJob: RemediationExecutor = async ({ context }) => {
  if (!JOB_REQUEUE_ENDPOINT) {
    return unsupported(
      "Failed-job requeue is not configured. Set JOB_REQUEUE_ENDPOINT to enable this action."
    );
  }

  const response = await fetch(JOB_REQUEUE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: context.projectId,
      serviceId: context.serviceId,
      incidentId: context.incidentId,
      alertId: context.alertId,
      limit: context.limit ?? 100
    })
  });

  if (!response.ok) {
    return {
      success: false,
      status: "FAILED",
      summary: `Failed-job requeue endpoint returned ${response.status}`
    };
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return completed("Failed jobs re-queued.", payload);
};
