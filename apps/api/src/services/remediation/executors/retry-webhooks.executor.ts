import { redeliverAlertNotifications } from "../../notifications/notification.service";
import type { RemediationExecutor } from "../types";
import { completed, resolveScope } from "./_common";

export const executeRetryWebhooks: RemediationExecutor = async ({ context }) => {
  const scope = await resolveScope(context);
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  for (const alertId of scope.alertIds.slice(0, context.limit ?? 100)) {
    const result = await redeliverAlertNotifications(alertId, "WEBHOOK");
    attempted += result.attempted;
    succeeded += result.succeeded;
    failed += result.failed;
  }

  return completed(
    `Webhook redelivery completed: ${succeeded}/${attempted} succeeded, ${failed} failed.`,
    { retriedAlerts: scope.alertIds.length, attempted, succeeded, failed }
  );
};
