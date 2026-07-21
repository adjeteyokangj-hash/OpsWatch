import type { BillingStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  entitlementFeatureDisabled,
  entitlementLimitExceeded,
  subscriptionReadOnly
} from "../../lib/entitlement-errors";
import {
  ENTITLEMENT_KEYS,
  normalizeEntitlementKey,
  type EntitlementKey,
  type LimitEntitlementKey
} from "./entitlement-keys";
import { DEFAULT_LAUNCH_PLAN_CODE, type PlanCode } from "./plan-definitions";
import { mapSubscriptionEntitlements, type ResolvedEntitlement } from "./entitlement.service";

/**
 * Application-scoped entitlements. Unlike the organisation entitlement service,
 * limits and features are resolved from the SELECTED application's ProjectBilling
 * plan (planCode) and usage is counted for THAT project only. This is the source
 * of truth for per-application plan limits and feature gating.
 */

export type ProjectAccessMode = "FULL" | "GRACE" | "PERIOD_END" | "RESTRICTED";

export type ProjectEntitlements = {
  organizationId: string;
  projectId: string;
  planCode: PlanCode;
  planName: string;
  billingStatus: BillingStatus;
  accessMode: ProjectAccessMode;
  billingWarning: string | null;
  allowMutations: boolean;
  entitlements: Record<string, ResolvedEntitlement>;
};

const asPlanCode = (value: string | null | undefined): PlanCode => {
  const candidate = (value ?? "").toUpperCase();
  if (["PILOT", "STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"].includes(candidate)) {
    return candidate as PlanCode;
  }
  return DEFAULT_LAUNCH_PLAN_CODE;
};

type BillingSnapshot = {
  planCode: string | null;
  billingStatus: BillingStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
};

const resolveProjectAccess = (
  billing: BillingSnapshot | null,
  now = new Date()
): { mode: ProjectAccessMode; allowMutations: boolean; billingWarning: string | null; effectivePlanCode: PlanCode } => {
  if (!billing) {
    return { mode: "FULL", allowMutations: true, billingWarning: null, effectivePlanCode: DEFAULT_LAUNCH_PLAN_CODE };
  }
  const planCode = asPlanCode(billing.planCode);
  const periodActive = billing.currentPeriodEnd != null && billing.currentPeriodEnd.getTime() > now.getTime();

  switch (billing.billingStatus) {
    case "ACTIVE":
    case "TRIAL":
      return { mode: "FULL", allowMutations: true, billingWarning: null, effectivePlanCode: planCode };
    case "PAST_DUE":
      return {
        mode: "GRACE",
        allowMutations: true,
        billingWarning: "Payment is past due for this application. Update billing to avoid restrictions.",
        effectivePlanCode: planCode
      };
    case "CANCELLED":
      if (billing.cancelAtPeriodEnd && periodActive) {
        return {
          mode: "PERIOD_END",
          allowMutations: true,
          billingWarning: "This application's subscription cancels at period end. Access continues until then.",
          effectivePlanCode: planCode
        };
      }
      return {
        mode: "RESTRICTED",
        allowMutations: false,
        billingWarning: "This application's subscription has ended. Access is restricted.",
        effectivePlanCode: DEFAULT_LAUNCH_PLAN_CODE
      };
    case "SUSPENDED":
    default:
      return {
        mode: "RESTRICTED",
        allowMutations: false,
        billingWarning: "This application's subscription is suspended. Access is restricted.",
        effectivePlanCode: DEFAULT_LAUNCH_PLAN_CODE
      };
  }
};

const applyProjectAccess = (
  entitlements: Record<string, ResolvedEntitlement>,
  allowMutations: boolean
): Record<string, ResolvedEntitlement> => {
  if (allowMutations) return entitlements;
  const gated = { ...entitlements };
  for (const [key, row] of Object.entries(gated)) {
    if (
      key.includes(".max") ||
      key.includes("remediation.autonomous") ||
      key.includes("remediation.approval") ||
      key.includes("diagnosis.ai")
    ) {
      gated[key] = { ...row, enabled: false };
    }
  }
  return gated;
};

export const getProjectEntitlements = async (
  organizationId: string,
  projectId: string
): Promise<ProjectEntitlements> => {
  const billing = await prisma.projectBilling.findUnique({
    where: { projectId },
    select: { planCode: true, billingStatus: true, cancelAtPeriodEnd: true, currentPeriodEnd: true }
  });

  const access = resolveProjectAccess(billing);
  const plan = await prisma.plan.findUnique({
    where: { code: access.effectivePlanCode },
    include: { PlanEntitlement: true }
  });

  if (!plan) {
    // Plans not seeded yet — seed then retry once.
    const { seedPlans } = await import("./subscription.service");
    await seedPlans();
    const seeded = await prisma.plan.findUniqueOrThrow({
      where: { code: access.effectivePlanCode },
      include: { PlanEntitlement: true }
    });
    return buildBundle(organizationId, projectId, billing, access, seeded);
  }

  return buildBundle(organizationId, projectId, billing, access, plan);
};

const buildBundle = (
  organizationId: string,
  projectId: string,
  billing: BillingSnapshot | null,
  access: ReturnType<typeof resolveProjectAccess>,
  plan: { name: string; PlanEntitlement: Array<{ featureKey: string; enabled: boolean; limit: number | null; retentionDays: number | null; configuration: unknown }> }
): ProjectEntitlements => ({
  organizationId,
  projectId,
  planCode: access.effectivePlanCode,
  planName: plan.name,
  billingStatus: billing?.billingStatus ?? "ACTIVE",
  accessMode: access.mode,
  billingWarning: access.billingWarning,
  allowMutations: access.allowMutations,
  entitlements: applyProjectAccess(mapSubscriptionEntitlements(plan.PlanEntitlement), access.allowMutations)
});

export const getProjectEntitlement = async (
  organizationId: string,
  projectId: string,
  featureKey: EntitlementKey
): Promise<ResolvedEntitlement> => {
  const bundle = await getProjectEntitlements(organizationId, projectId);
  const normalized = normalizeEntitlementKey(featureKey);
  return (
    bundle.entitlements[normalized] ?? {
      featureKey,
      enabled: false,
      limit: null,
      retentionDays: null,
      configuration: null
    }
  );
};

export const isProjectEntitlementEnabled = async (
  organizationId: string,
  projectId: string,
  featureKey: EntitlementKey
): Promise<boolean> => (await getProjectEntitlement(organizationId, projectId, featureKey)).enabled;

export const assertProjectEntitlementEnabled = async (
  organizationId: string,
  projectId: string,
  featureKey: EntitlementKey
): Promise<void> => {
  const entitlement = await getProjectEntitlement(organizationId, projectId, featureKey);
  if (!entitlement.enabled) throw entitlementFeatureDisabled(featureKey);
};

/** Count usage of a limited resource for THIS project only. */
export const countProjectUsage = async (
  projectId: string,
  featureKey: LimitEntitlementKey
): Promise<number> => {
  switch (featureKey) {
    case ENTITLEMENT_KEYS.MONITORING_MONITORS_MAX:
      return prisma.check.count({ where: { isActive: true, Service: { projectId } } });
    case ENTITLEMENT_KEYS.MONITORING_SLOS_MAX:
      return prisma.sLODefinition.count({ where: { projectId, archivedAt: null } });
    case ENTITLEMENT_KEYS.NOTIFICATIONS_CHANNELS_MAX:
      return prisma.notificationChannel.count({ where: { projectId, isActive: true } });
    default:
      // Organisation-level administrative limits (applications, team members,
      // status pages) are not application-scoped and are not counted here.
      return 0;
  }
};

export const assertProjectWithinLimit = async (
  organizationId: string,
  projectId: string,
  featureKey: LimitEntitlementKey,
  increment = 1
): Promise<void> => {
  const bundle = await getProjectEntitlements(organizationId, projectId);
  if (increment > 0 && !bundle.allowMutations) {
    throw subscriptionReadOnly(bundle.billingStatus);
  }
  const entitlement = bundle.entitlements[normalizeEntitlementKey(featureKey)];
  if (!entitlement || !entitlement.enabled) {
    throw entitlementFeatureDisabled(featureKey);
  }
  if (entitlement.limit == null) return;
  const current = await countProjectUsage(projectId, featureKey);
  if (current + increment > entitlement.limit) {
    throw entitlementLimitExceeded(featureKey, current, entitlement.limit);
  }
};

export const getProjectMinimumCheckIntervalSeconds = async (
  organizationId: string,
  projectId: string
): Promise<number> => {
  const entitlement = await getProjectEntitlement(
    organizationId,
    projectId,
    ENTITLEMENT_KEYS.MONITORING_INTERVAL_MIN
  );
  return entitlement.limit ?? 60;
};

export const assertProjectCheckIntervalAllowed = async (
  organizationId: string,
  projectId: string,
  intervalSeconds: number
): Promise<void> => {
  const minimum = await getProjectMinimumCheckIntervalSeconds(organizationId, projectId);
  if (intervalSeconds < minimum) {
    const { checkIntervalTooFast } = await import("../../lib/entitlement-errors");
    throw checkIntervalTooFast(intervalSeconds, minimum);
  }
};

export type ProjectMonitorCapacity = {
  enabled: boolean;
  allowMutations: boolean;
  limit: number | null;
  current: number;
  available: number | null;
};

/**
 * Project-scoped monitor capacity, read inside the caller's transaction. Callers
 * consuming capacity must lock the relevant rows before invoking this.
 */
export const getProjectMonitorCapacityInTransaction = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  projectId: string
): Promise<ProjectMonitorCapacity> => {
  const bundle = await getProjectEntitlements(organizationId, projectId);
  const monitor = bundle.entitlements[ENTITLEMENT_KEYS.MONITORING_MONITORS_MAX];
  const current = await tx.check.count({ where: { isActive: true, Service: { projectId } } });
  const limit = monitor?.limit ?? null;
  return {
    enabled: Boolean(monitor?.enabled),
    allowMutations: bundle.allowMutations,
    limit,
    current,
    available: limit == null ? null : Math.max(0, limit - current)
  };
};

export const getProjectUsageSnapshot = async (organizationId: string, projectId: string) => {
  const bundle = await getProjectEntitlements(organizationId, projectId);
  const keys: LimitEntitlementKey[] = [
    ENTITLEMENT_KEYS.MONITORING_MONITORS_MAX,
    ENTITLEMENT_KEYS.MONITORING_SLOS_MAX,
    ENTITLEMENT_KEYS.NOTIFICATIONS_CHANNELS_MAX
  ];
  const rows = await Promise.all(
    keys.map(async (featureKey) => {
      const entitlement = bundle.entitlements[normalizeEntitlementKey(featureKey)];
      const current = await countProjectUsage(projectId, featureKey);
      return {
        featureKey,
        current,
        limit: entitlement?.limit ?? null,
        unlimited: (entitlement?.limit ?? null) == null
      };
    })
  );
  return Object.fromEntries(rows.map((row) => [row.featureKey, row]));
};
