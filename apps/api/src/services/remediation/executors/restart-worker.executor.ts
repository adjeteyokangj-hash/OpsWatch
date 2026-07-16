import type { RemediationExecutor } from "../types";
import { completed, misconfigured, failed } from "./_common";
import { executeRemediatorRepair } from "../remediator-provider.service";

/**
 * Worker restart via project-scoped remediator webhook (TrueNumeris / Integration Outbox path).
 * Never claims success without a configured, validated remediator and post-action verification.
 */
export const executeRestartWorker: RemediationExecutor = async ({ context }) => {
  if (!context.projectId) {
    return misconfigured("Worker restart requires a project-scoped remediator.", ["projectId"]);
  }

  const result = await executeRemediatorRepair({
    registryAction: "RESTART_WORKER",
    context: {
      ...context,
      extra: {
        ...(context.extra ?? {}),
        remediatorAction:
          (typeof context.extra?.remediatorAction === "string" && context.extra.remediatorAction) ||
          "restart_sync_worker"
      }
    },
    providerType: "WORKER_PROVIDER"
  });

  // Preserve legacy env fallback only when remediator reports missing provider AND env is set —
  // never simulate success without a webhook.
  if (
    result.status === "MISCONFIGURED_ENV" &&
    result.missingEnvVars?.includes("MISSING_PROVIDER") &&
    process.env.WORKER_RESTART_WEBHOOK_URL
  ) {
    const response = await fetch(process.env.WORKER_RESTART_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: context.projectId,
        serviceId: context.serviceId,
        incidentId: context.incidentId,
        legacyEnvFallback: true
      })
    });
    if (!response.ok) {
      return failed(`Legacy worker restart webhook failed with ${response.status}`);
    }
    return failed(
      "Legacy env webhook returned HTTP success, but OpsWatch requires a validated project remediator with post-action verification. Configure WORKER_PROVIDER on the project Integrations page.",
      { reason: "LEGACY_ENV_INSUFFICIENT" }
    );
  }

  return result.status === "COMPLETED"
    ? completed(result.summary, result.details)
    : result;
};
