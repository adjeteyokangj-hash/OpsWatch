import { prisma } from "../lib/prisma";
import { getSubscriptionSummary } from "./entitlements/subscription.service";

export type PlanId = "FREE" | "STARTER" | "PRO" | "ENTERPRISE";

export const PLAN_LIMITS: Record<PlanId, { projects: number; checks: number; users: number; retention: number }> = {
  FREE:       { projects: 3,   checks: 10,  users: 2,   retention: 7   },
  STARTER:    { projects: 10,  checks: 50,  users: 5,   retention: 30  },
  PRO:        { projects: 50,  checks: 200, users: 20,  retention: 90  },
  ENTERPRISE: { projects: 9999, checks: 9999, users: 9999, retention: 365 }
};

export const PLAN_PRICES: Record<PlanId, { monthly: number; currency: string }> = {
  FREE:       { monthly: 0,   currency: "USD" },
  STARTER:    { monthly: 29,  currency: "USD" },
  PRO:        { monthly: 99,  currency: "USD" },
  ENTERPRISE: { monthly: 499, currency: "USD" }
};

export const getBillingInfo = async (organizationId: string) => {
  const subscriptionSummary = await getSubscriptionSummary(organizationId);
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new Error("Organization not found");

  return {
    organization: { id: org.id, name: org.name, plan: org.plan },
    subscription: subscriptionSummary.subscription,
    plan: subscriptionSummary.plan,
    entitlements: subscriptionSummary.entitlements,
    usage: subscriptionSummary.usage,
    availablePlans: subscriptionSummary.availablePlans,
    legacy: {
      limits: PLAN_LIMITS[org.plan as PlanId],
      price: PLAN_PRICES[org.plan as PlanId],
      plans: Object.entries(PLAN_LIMITS).map(([id, limits]) => ({
        id,
        limits,
        price: PLAN_PRICES[id as PlanId]
      }))
    }
  };
};

export const upgradePlan = async (organizationId: string, plan: PlanId) => {
  const legacyPlanMap = {
    FREE: "PILOT",
    STARTER: "STARTER",
    PRO: "GROWTH",
    ENTERPRISE: "ENTERPRISE"
  } as const;

  const { assignSubscriptionPlan } = await import("./entitlements/subscription.service");
  const subscription = await assignSubscriptionPlan({
    organizationId,
    planCode: legacyPlanMap[plan]
  });

  const org = await prisma.organization.update({
    where: { id: organizationId },
    data: { plan }
  });

  return {
    organization: org,
    subscription,
    message: `Plan updated to ${plan}. Payment processing can be connected when checkout is enabled.`
  };
};

export const checkPlanLimit = async (organizationId: string, resource: "projects" | "checks" | "users"): Promise<boolean> => {
  const { getUsageSnapshot } = await import("./entitlements/entitlement.service");
  const { ENTITLEMENT } = await import("./entitlements/entitlement-keys");
  const usage = await getUsageSnapshot(organizationId);

  const key =
    resource === "projects"
      ? ENTITLEMENT.APPLICATIONS_MAX
      : resource === "checks"
        ? ENTITLEMENT.MONITORS_MAX
        : ENTITLEMENT.TEAM_MEMBERS_MAX;

  const row = usage[key];
  if (!row || row.unlimited) return true;
  if (row.limit == null) return true;
  return row.current < row.limit;
};
