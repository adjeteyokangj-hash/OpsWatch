import type { Subscription, SubscriptionStatus } from "@prisma/client";
import { DEFAULT_LAUNCH_PLAN_CODE, type PlanCode } from "./plan-definitions";

export type SubscriptionAccessMode =
  | "FULL"
  | "GRACE"
  | "READ_ONLY"
  | "PERIOD_END"
  | "RESTRICTED"
  | "DEFAULT";

export type SubscriptionAccess = {
  mode: SubscriptionAccessMode;
  billingWarning: string | null;
  effectivePlanCode: PlanCode;
  allowMutations: boolean;
  allowMonitoringExecution: boolean;
  status: SubscriptionStatus | "MISSING";
};

const FALLBACK_PLAN_CODE: PlanCode = DEFAULT_LAUNCH_PLAN_CODE;

export const resolveSubscriptionAccess = (input: {
  subscription: Pick<
    Subscription,
    "status" | "cancelAtPeriodEnd" | "currentPeriodEnd" | "planId"
  > | null;
  planCode: PlanCode;
  now?: Date;
}): SubscriptionAccess => {
  const now = input.now ?? new Date();

  if (!input.subscription) {
    return {
      mode: "DEFAULT",
      billingWarning: null,
      effectivePlanCode: FALLBACK_PLAN_CODE,
      allowMutations: true,
      allowMonitoringExecution: true,
      status: "MISSING"
    };
  }

  const { subscription, planCode } = input;
  const periodActive =
    subscription.currentPeriodEnd != null && subscription.currentPeriodEnd.getTime() > now.getTime();

  if (subscription.status === "ACTIVE" || subscription.status === "TRIAL") {
    return {
      mode: "FULL",
      billingWarning: null,
      effectivePlanCode: planCode,
      allowMutations: true,
      allowMonitoringExecution: true,
      status: subscription.status
    };
  }

  if (subscription.status === "PAST_DUE") {
    return {
      mode: "GRACE",
      billingWarning: "Payment is past due. Update billing to avoid service restrictions.",
      effectivePlanCode: planCode,
      allowMutations: true,
      allowMonitoringExecution: true,
      status: subscription.status
    };
  }

  if (subscription.status === "UNPAID") {
    return {
      mode: "READ_ONLY",
      billingWarning: "Subscription is unpaid. Monitoring execution and new changes are restricted.",
      effectivePlanCode: planCode,
      allowMutations: false,
      allowMonitoringExecution: false,
      status: subscription.status
    };
  }

  if (subscription.status === "CANCELLED" && subscription.cancelAtPeriodEnd && periodActive) {
    return {
      mode: "PERIOD_END",
      billingWarning: "Subscription cancels at period end. Access continues until then.",
      effectivePlanCode: planCode,
      allowMutations: true,
      allowMonitoringExecution: true,
      status: subscription.status
    };
  }

  if (subscription.status === "CANCELLED" || subscription.status === "SUSPENDED") {
    return {
      mode: "RESTRICTED",
      billingWarning:
        subscription.status === "CANCELLED"
          ? "Subscription ended. Account is on restricted access."
          : "Subscription is suspended. Account is on restricted access.",
      effectivePlanCode: FALLBACK_PLAN_CODE,
      allowMutations: false,
      allowMonitoringExecution: false,
      status: subscription.status
    };
  }

  return {
    mode: "RESTRICTED",
    billingWarning: "Subscription is not active.",
    effectivePlanCode: FALLBACK_PLAN_CODE,
    allowMutations: false,
    allowMonitoringExecution: false,
    status: subscription.status
  };
};

export const applySubscriptionAccessToEntitlements = <
  T extends { enabled: boolean; limit: number | null }
>(
  entitlements: Record<string, T>,
  access: SubscriptionAccess
): Record<string, T> => {
  if (access.allowMutations) {
    return entitlements;
  }

  const gated = { ...entitlements };
  for (const [key, row] of Object.entries(gated)) {
    if (key.includes(".max")) {
      gated[key] = { ...row, enabled: false };
      continue;
    }
    if (
      key.includes("remediation.autonomous") ||
      key.includes("remediation.approval") ||
      key.includes("diagnosis.ai")
    ) {
      gated[key] = { ...row, enabled: false };
    }
  }
  return gated;
};
