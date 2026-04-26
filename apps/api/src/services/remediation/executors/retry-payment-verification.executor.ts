import type { RemediationExecutor } from "../types";
import { completed, unsupported } from "./_common";

const PAYMENT_VERIFICATION_ENDPOINT = process.env.PAYMENT_VERIFICATION_ENDPOINT;

export const executeRetryPaymentVerification: RemediationExecutor = async ({ context }) => {
  if (!PAYMENT_VERIFICATION_ENDPOINT) {
    return unsupported(
      "Payment verification retry is not configured. Set PAYMENT_VERIFICATION_ENDPOINT to enable this action."
    );
  }

  const response = await fetch(PAYMENT_VERIFICATION_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: context.projectId,
      serviceId: context.serviceId,
      incidentId: context.incidentId,
      alertId: context.alertId,
      limit: context.limit ?? 50
    })
  });

  if (!response.ok) {
    return {
      success: false,
      status: "FAILED",
      summary: `Payment verification endpoint returned ${response.status}`
    };
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return completed("Payment verification retry submitted.", payload);
};
