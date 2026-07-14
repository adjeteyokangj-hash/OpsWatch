import { randomUUID } from "crypto";
import type { SubscriptionStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  DEFAULT_LAUNCH_PLAN_CODE,
  PLAN_DEFINITIONS,
  getPlanDefinition,
  type PlanCode
} from "./plan-definitions";
import { mapSubscriptionEntitlements, type OrganizationEntitlements } from "./entitlement.service";
import { groupEntitlementsByDomain } from "./entitlement-keys";
import { resolveRemediationGovernance } from "./remediation-governance.service";

const now = () => new Date();

const periodEndFromStart = (start: Date): Date => {
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
};

export const seedPlans = async (): Promise<void> => {
  for (const definition of PLAN_DEFINITIONS) {
    const planId = `plan_${definition.code.toLowerCase()}`;
    await prisma.plan.upsert({
      where: { code: definition.code },
      update: {
        name: definition.name,
        monthlyPrice: definition.monthlyPrice,
        annualPrice: definition.annualPrice,
        currency: definition.currency,
        active: definition.active,
        sortOrder: definition.sortOrder,
        updatedAt: now()
      },
      create: {
        id: planId,
        code: definition.code,
        name: definition.name,
        monthlyPrice: definition.monthlyPrice,
        annualPrice: definition.annualPrice,
        currency: definition.currency,
        active: definition.active,
        sortOrder: definition.sortOrder,
        updatedAt: now()
      }
    });

    const plan = await prisma.plan.findUniqueOrThrow({ where: { code: definition.code } });
    for (const row of definition.entitlements) {
      await prisma.planEntitlement.upsert({
        where: {
          planId_featureKey: {
            planId: plan.id,
            featureKey: row.featureKey
          }
        },
        update: {
          enabled: row.enabled,
          limit: row.limit ?? null,
          retentionDays: row.retentionDays ?? null,
          configuration: (row.configuration ?? undefined) as Prisma.InputJsonValue | undefined
        },
        create: {
          id: randomUUID(),
          planId: plan.id,
          featureKey: row.featureKey,
          enabled: row.enabled,
          limit: row.limit ?? null,
          retentionDays: row.retentionDays ?? null,
          configuration: (row.configuration ?? undefined) as Prisma.InputJsonValue | undefined
        }
      });
    }
  }
};

export const getPlanByCode = async (code: PlanCode) => {
  return prisma.plan.findUnique({
    where: { code },
    include: { PlanEntitlement: true }
  });
};

export const ensureDefaultSubscription = async (
  organizationId: string,
  planCode: PlanCode = DEFAULT_LAUNCH_PLAN_CODE
): Promise<OrganizationEntitlements> => {
  await seedPlans();

  const existing = await prisma.subscription.findUnique({
    where: { organizationId },
    include: { Plan: { include: { PlanEntitlement: true } } }
  });
  if (existing) {
    return {
      organizationId,
      planCode: existing.Plan.code,
      planName: existing.Plan.name,
      subscriptionStatus: existing.status,
      accessMode: "FULL" as const,
      billingWarning: null,
      allowMutations: true,
      allowMonitoringExecution: true,
      entitlements: mapSubscriptionEntitlements(existing.Plan.PlanEntitlement)
    };
  }

  const plan = await getPlanByCode(planCode);
  if (!plan) {
    throw new Error(`Plan not found: ${planCode}`);
  }

  const start = now();
  try {
    const subscription = await prisma.subscription.create({
      data: {
        id: randomUUID(),
        organizationId,
        planId: plan.id,
        status: "ACTIVE",
        currentPeriodStart: start,
        currentPeriodEnd: periodEndFromStart(start),
        updatedAt: start
      },
      include: { Plan: { include: { PlanEntitlement: true } } }
    });

    return {
      organizationId,
      planCode: subscription.Plan.code,
      planName: subscription.Plan.name,
      subscriptionStatus: subscription.status,
      accessMode: "FULL" as const,
      billingWarning: null,
      allowMutations: true,
      allowMonitoringExecution: true,
      entitlements: mapSubscriptionEntitlements(subscription.Plan.PlanEntitlement)
    };
  } catch (error) {
    // Concurrent callers can race on organizationId unique — re-read winner.
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code !== "P2002") {
      throw error;
    }
    const raced = await prisma.subscription.findUnique({
      where: { organizationId },
      include: { Plan: { include: { PlanEntitlement: true } } }
    });
    if (!raced) {
      throw error;
    }
    return {
      organizationId,
      planCode: raced.Plan.code,
      planName: raced.Plan.name,
      subscriptionStatus: raced.status,
      accessMode: "FULL" as const,
      billingWarning: null,
      allowMutations: true,
      allowMonitoringExecution: true,
      entitlements: mapSubscriptionEntitlements(raced.Plan.PlanEntitlement)
    };
  }
};

export const assignSubscriptionPlan = async (input: {
  organizationId: string;
  planCode: PlanCode;
  status?: SubscriptionStatus;
  trialEndsAt?: Date | null;
  updatedById?: string;
}) => {
  await seedPlans();
  const definition = getPlanDefinition(input.planCode);
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: definition.code } });
  const start = now();

  const subscription = await prisma.subscription.upsert({
    where: { organizationId: input.organizationId },
    update: {
      planId: plan.id,
      status: input.status ?? "ACTIVE",
      trialEndsAt: input.trialEndsAt ?? null,
      currentPeriodStart: start,
      currentPeriodEnd: periodEndFromStart(start),
      updatedAt: start
    },
    create: {
      id: randomUUID(),
      organizationId: input.organizationId,
      planId: plan.id,
      status: input.status ?? "ACTIVE",
      trialEndsAt: input.trialEndsAt ?? null,
      currentPeriodStart: start,
      currentPeriodEnd: periodEndFromStart(start),
      updatedAt: start
    },
    include: {
      Plan: {
        include: { PlanEntitlement: true }
      }
    }
  });

  if (input.updatedById) {
    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        userId: input.updatedById,
        action: "SUBSCRIPTION_PLAN_ASSIGNED",
        entityType: "SUBSCRIPTION",
        entityId: subscription.id,
        metadataJson: {
          organizationId: input.organizationId,
          planCode: definition.code,
          status: subscription.status
        }
      }
    });
  }

  return subscription;
};

export const getSubscriptionSummary = async (organizationId: string) => {
  const { getOrganizationEntitlements, getUsageSnapshot } = await import("./entitlement.service");
  const [entitlements, usage, plans, governance] = await Promise.all([
    getOrganizationEntitlements(organizationId),
    getUsageSnapshot(organizationId),
    prisma.plan.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      include: { PlanEntitlement: true }
    }),
    resolveRemediationGovernance(organizationId)
  ]);

  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    include: { Plan: true }
  });

  return {
    subscription: subscription
      ? {
          id: subscription.id,
          status: subscription.status,
          trialEndsAt: subscription.trialEndsAt,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          stripeCustomerId: subscription.stripeCustomerId,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          pendingSync: Boolean(subscription.stripeSubscriptionId && subscription.status === "SUSPENDED")
        }
      : null,
    plan: {
      code: entitlements.planCode,
      name: entitlements.planName
    },
    accessMode: entitlements.accessMode,
    billingWarning: entitlements.billingWarning,
    allowMutations: entitlements.allowMutations,
    entitlements: entitlements.entitlements,
    entitlementsByDomain: groupEntitlementsByDomain(entitlements.entitlements),
    remediationGovernance: governance,
    usage,
    availablePlans: plans.map((plan) => ({
      code: plan.code,
      name: plan.name,
      monthlyPrice: plan.monthlyPrice,
      annualPrice: plan.annualPrice,
      currency: plan.currency,
      entitlements: plan.PlanEntitlement
    }))
  };
};

export const backfillOrganizationSubscriptions = async (): Promise<number> => {
  await seedPlans();
  const organizations = await prisma.organization.findMany({ select: { id: true, plan: true } });
  let created = 0;

  for (const org of organizations) {
    const existing = await prisma.subscription.findUnique({ where: { organizationId: org.id } });
    if (existing) continue;

    const legacyPlanMap: Record<string, PlanCode> = {
      FREE: "PILOT",
      STARTER: "STARTER",
      PRO: "GROWTH",
      ENTERPRISE: "ENTERPRISE"
    };
    const planCode = legacyPlanMap[org.plan] ?? DEFAULT_LAUNCH_PLAN_CODE;
    await ensureDefaultSubscription(org.id, planCode);
    created += 1;
  }

  return created;
};
