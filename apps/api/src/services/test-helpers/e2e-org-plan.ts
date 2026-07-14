import { assignSubscriptionPlan } from "../entitlements/subscription.service";
import type { PlanCode } from "../entitlements/plan-definitions";

/**
 * Assign a paid plan for database E2E fixtures so remediation/automation
 * entitlements match production-gated behaviour (PILOT denies approval).
 * Additive: upserts subscription; does not wipe org data.
 */
export const ensureE2EOrgPlan = async (
  organizationId: string,
  planCode: PlanCode = "GROWTH"
): Promise<void> => {
  await assignSubscriptionPlan({
    organizationId,
    planCode,
    status: "ACTIVE"
  });
};
