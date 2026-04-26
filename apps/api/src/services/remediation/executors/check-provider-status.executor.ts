import type { RemediationExecutor } from "../types";
import { completed, unsupported } from "./_common";

const PROVIDER_STATUS_URL = process.env.PROVIDER_STATUS_URL;

export const executeCheckProviderStatus: RemediationExecutor = async ({ context }) => {
  if (!PROVIDER_STATUS_URL) {
    return unsupported("Provider status endpoint not configured. Set PROVIDER_STATUS_URL.");
  }

  const response = await fetch(PROVIDER_STATUS_URL, {
    method: "GET",
    headers: { "Content-Type": "application/json" }
  });

  if (!response.ok) {
    return {
      success: false,
      status: "FAILED",
      summary: `Provider status check failed with ${response.status}`
    };
  }

  const details = (await response.json()) as Record<string, unknown>;
  return completed("Provider status fetched.", {
    incidentId: context.incidentId,
    provider: details
  });
};
