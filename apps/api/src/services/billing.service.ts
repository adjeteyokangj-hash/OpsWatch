import { prisma } from "../lib/prisma";

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
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new Error("Organization not found");

  const [projectCount, userCount] = await Promise.all([
    prisma.project.count({ where: { organizationId } }),
    prisma.user.count({ where: { organizationId } })
  ]);

  const checkCount = await prisma.check.count({
    where: { Service: { Project: { organizationId } } }
  });

  const plan = org.plan as PlanId;
  const limits = PLAN_LIMITS[plan];
  const price = PLAN_PRICES[plan];

  return {
    organization: { id: org.id, name: org.name, plan: org.plan },
    limits,
    usage: { projects: projectCount, users: userCount, checks: checkCount },
    price,
    plans: Object.entries(PLAN_LIMITS).map(([id, l]) => ({
      id,
      limits: l,
      price: PLAN_PRICES[id as PlanId]
    }))
  };
};

export const upgradePlan = async (organizationId: string, plan: PlanId) => {
  const org = await prisma.organization.update({
    where: { id: organizationId },
    data: { plan }
  });

  return { organization: org, message: `Plan updated to ${plan}. Connect Stripe/Paystack for payment processing.` };
};

export const checkPlanLimit = async (organizationId: string, resource: "projects" | "checks" | "users"): Promise<boolean> => {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) return false;

  const plan = org.plan as PlanId;
  const limit = PLAN_LIMITS[plan][resource];

  let count = 0;
  if (resource === "projects") {
    count = await prisma.project.count({ where: { organizationId } });
  } else if (resource === "users") {
    count = await prisma.user.count({ where: { organizationId } });
  } else if (resource === "checks") {
    count = await prisma.check.count({ where: { Service: { Project: { organizationId } } } });
  }

  return count < limit;
};
