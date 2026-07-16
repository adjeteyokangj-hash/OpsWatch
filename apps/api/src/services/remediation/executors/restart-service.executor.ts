import type { RemediationExecutor } from "../types";
import { completed, misconfigured } from "./_common";
import { executeRemediatorRepair } from "../remediator-provider.service";

/** Service restart via project SERVICE_PROVIDER remediator (schema/UI ready; uses remediator path). */
export const executeRestartService: RemediationExecutor = async ({ context }) => {
  if (!context.projectId || !context.serviceId) {
    return misconfigured("Service restart requires projectId and serviceId.", [
      "projectId",
      "serviceId"
    ]);
  }

  const result = await executeRemediatorRepair({
    registryAction: "RESTART_SERVICE",
    context: {
      ...context,
      extra: {
        ...(context.extra ?? {}),
        remediatorAction: "restart_service"
      }
    },
    providerType: "SERVICE_PROVIDER"
  });

  return result.status === "COMPLETED" ? completed(result.summary, result.details) : result;
};
