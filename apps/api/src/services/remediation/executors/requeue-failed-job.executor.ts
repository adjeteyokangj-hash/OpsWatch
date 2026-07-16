import type { RemediationExecutor } from "../types";
import { completed, misconfigured, failed, unsupported } from "./_common";
import { executeRemediatorRepair } from "../remediator-provider.service";

/**
 * Requeue / retry failed jobs via Worker remediator (retry_failed_jobs / retry_outbox_item).
 */
export const executeRequeueFailedJob: RemediationExecutor = async ({ context }) => {
  if (context.projectId) {
    const remediatorAction =
      (typeof context.extra?.remediatorAction === "string" && context.extra.remediatorAction) ||
      "retry_failed_jobs";

    const result = await executeRemediatorRepair({
      registryAction: "REQUEUE_FAILED_JOB",
      context: {
        ...context,
        extra: {
          ...(context.extra ?? {}),
          remediatorAction
        }
      },
      providerType: "WORKER_PROVIDER"
    });

    if (result.status !== "MISCONFIGURED_ENV") {
      return result.status === "COMPLETED"
        ? completed(result.summary, result.details)
        : result;
    }

    // Fall through to legacy endpoint only when remediator is absent — still no fake success.
    if (!process.env.JOB_REQUEUE_ENDPOINT) {
      return result;
    }
  }

  const JOB_REQUEUE_ENDPOINT = process.env.JOB_REQUEUE_ENDPOINT;
  if (!JOB_REQUEUE_ENDPOINT) {
    return unsupported(
      "Failed-job requeue is not configured. Connect a Worker remediator (retry_failed_jobs) or set JOB_REQUEUE_ENDPOINT."
    );
  }

  if (!context.projectId) {
    return misconfigured("Job requeue requires project context.", ["projectId"]);
  }

  const response = await fetch(JOB_REQUEUE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: context.projectId,
      serviceId: context.serviceId,
      incidentId: context.incidentId,
      alertId: context.alertId,
      limit: context.limit ?? 100,
      legacyEnvFallback: true
    })
  });

  if (!response.ok) {
    return failed(`Failed-job requeue endpoint returned ${response.status}`);
  }

  return failed(
    "Legacy job requeue endpoint returned HTTP success, but OpsWatch requires a validated Worker remediator with post-action verification for repair status.",
    { reason: "LEGACY_ENV_INSUFFICIENT" }
  );
};
