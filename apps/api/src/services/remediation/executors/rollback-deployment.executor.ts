import type { RemediationExecutor } from "../types";
import { completed, misconfigured } from "./_common";
import { executeRemediatorRepair } from "../remediator-provider.service";

/** Deployment rollback via project DEPLOYMENT_PROVIDER remediator. */
export const executeRollbackDeployment: RemediationExecutor = async ({ context }) => {
  if (!context.projectId) {
    return misconfigured("Deployment rollback requires projectId.", ["projectId"]);
  }

  const result = await executeRemediatorRepair({
    registryAction: "ROLLBACK_DEPLOYMENT",
    context: {
      ...context,
      extra: {
        ...(context.extra ?? {}),
        remediatorAction: "rollback_deployment"
      }
    },
    providerType: "DEPLOYMENT_PROVIDER"
  });

  return result.status === "COMPLETED" ? completed(result.summary, result.details) : result;
};
