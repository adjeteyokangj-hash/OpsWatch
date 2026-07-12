import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import {
  EntitlementError,
  entitlementFeatureDisabled,
  entitlementLimitExceeded,
  subscriptionInactive
} from "../../lib/entitlement-errors";
import {
  ENTITLEMENT_KEYS,
  LIMIT_ENTITLEMENT_KEYS,
  normalizeEntitlementKey,
  type EntitlementKey,
  type LimitEntitlementKey
} from "./entitlement-keys";
import { DEFAULT_LAUNCH_PLAN_CODE, type PlanCode } from "./plan-definitions";

export type ResolvedEntitlement = {
  featureKey: EntitlementKey;
  enabled: boolean;
  limit: number | null;
  retentionDays: number | null;
  configuration: Record<string, unknown> | null;
};

export type OrganizationEntitlements = {
  organizationId: string;
  planCode: string;
  planName: string;
  subscriptionStatus: string;
  entitlements: Record<string, ResolvedEntitlement>;
};

const normalizeLimit = (limit: number | null | undefined): number | null => {
  if (limit == null) return null;
  if (limit >= 9999) return null;
  return limit;
};

const countUsage = async (organizationId: string, featureKey: LimitEntitlementKey): Promise<number> => {
  switch (featureKey) {
    case ENTITLEMENT_KEYS.MONITORING_APPLICATIONS_MAX:
      return prisma.project.count({ where: { organizationId } });
    case ENTITLEMENT_KEYS.TEAM_MEMBERS_MAX:
      return prisma.user.count({ where: { organizationId, isActive: true } });
    case ENTITLEMENT_KEYS.MONITORING_MONITORS_MAX:
      return prisma.check.count({ where: { Service: { Project: { organizationId } } } });
    case ENTITLEMENT_KEYS.MONITORING_SLOS_MAX:
      return prisma.sLODefinition.count({
        where: { Project: { organizationId }, archivedAt: null }
      });
    case ENTITLEMENT_KEYS.STATUSPAGE_PAGES_MAX:
      return prisma.statusPage.count({ where: { organizationId } });
    case ENTITLEMENT_KEYS.NOTIFICATIONS_CHANNELS_MAX:
      return prisma.notificationChannel.count({
        where: { Project: { organizationId }, isActive: true }
      });
    default:
      return 0;
  }
};

export const mapSubscriptionEntitlements = (rows: Array<{
  featureKey: string;
  enabled: boolean;
  limit: number | null;
  retentionDays: number | null;
  configuration: unknown;
}>): Record<string, ResolvedEntitlement> => {
  const map: Record<string, ResolvedEntitlement> = {};
  for (const row of rows) {
    const featureKey = normalizeEntitlementKey(row.featureKey);
    map[featureKey] = {
      featureKey,
      enabled: row.enabled,
      limit: normalizeLimit(row.limit),
      retentionDays: row.retentionDays,
      configuration: (row.configuration as Record<string, unknown> | null) ?? null
    };
  }
  return map;
};

export const getOrganizationEntitlements = async (
  organizationId: string
): Promise<OrganizationEntitlements> => {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    include: {
      Plan: {
        include: { PlanEntitlement: true }
      }
    }
  });

  if (!subscription) {
    const { ensureDefaultSubscription } = await import("./subscription.service");
    const created = await ensureDefaultSubscription(organizationId);
    return created;
  }

  if (!["ACTIVE", "TRIAL"].includes(subscription.status)) {
    throw subscriptionInactive(subscription.status);
  }

  return {
    organizationId,
    planCode: subscription.Plan.code,
    planName: subscription.Plan.name,
    subscriptionStatus: subscription.status,
    entitlements: mapSubscriptionEntitlements(subscription.Plan.PlanEntitlement)
  };
};

export const getEntitlement = async (
  organizationId: string,
  featureKey: EntitlementKey
): Promise<ResolvedEntitlement> => {
  const bundle = await getOrganizationEntitlements(organizationId);
  const normalized = normalizeEntitlementKey(featureKey);
  const entitlement = bundle.entitlements[normalized];
  if (!entitlement) {
    return {
      featureKey,
      enabled: false,
      limit: null,
      retentionDays: null,
      configuration: null
    };
  }
  return entitlement;
};

export const isEntitlementEnabled = async (
  organizationId: string,
  featureKey: EntitlementKey
): Promise<boolean> => {
  const entitlement = await getEntitlement(organizationId, featureKey);
  return entitlement.enabled;
};

export const assertEntitlementEnabled = async (
  organizationId: string,
  featureKey: EntitlementKey
): Promise<void> => {
  const entitlement = await getEntitlement(organizationId, featureKey);
  if (!entitlement.enabled) {
    throw entitlementFeatureDisabled(featureKey);
  }
};

export const assertWithinLimit = async (
  organizationId: string,
  featureKey: LimitEntitlementKey,
  increment = 1
): Promise<void> => {
  const entitlement = await getEntitlement(organizationId, featureKey);
  if (!entitlement.enabled) {
    throw entitlementFeatureDisabled(featureKey);
  }
  const limit = entitlement.limit;
  if (limit == null) return;

  const current = await countUsage(organizationId, featureKey);
  if (current + increment > limit) {
    throw entitlementLimitExceeded(featureKey, current, limit);
  }
};

export const getUsageSnapshot = async (organizationId: string) => {
  const usageEntries = await Promise.all(
    LIMIT_ENTITLEMENT_KEYS.map(async (featureKey) => {
      const [entitlement, current] = await Promise.all([
        getEntitlement(organizationId, featureKey),
        countUsage(organizationId, featureKey)
      ]);
      return {
        featureKey,
        current,
        limit: entitlement.limit,
        unlimited: entitlement.limit == null
      };
    })
  );

  return Object.fromEntries(usageEntries.map((row) => [row.featureKey, row]));
};

export const recordUsageSnapshot = async (organizationId: string): Promise<void> => {
  const usage = await getUsageSnapshot(organizationId);
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  await prisma.$transaction(
    Object.entries(usage).map(([metricKey, row]) =>
      prisma.usageRecord.create({
        data: {
          id: randomUUID(),
          organizationId,
          metricKey,
          quantity: row.current,
          periodStart,
          periodEnd
        }
      })
    )
  );
};

export const getMinimumCheckIntervalSeconds = async (organizationId: string): Promise<number> => {
  const entitlement = await getEntitlement(
    organizationId,
    ENTITLEMENT_KEYS.MONITORING_INTERVAL_MIN
  );
  return entitlement.limit ?? 60;
};

export const assertCheckIntervalAllowed = async (
  organizationId: string,
  intervalSeconds: number
): Promise<void> => {
  const minimum = await getMinimumCheckIntervalSeconds(organizationId);
  if (intervalSeconds < minimum) {
    const { checkIntervalTooFast } = await import("../../lib/entitlement-errors");
    throw checkIntervalTooFast(intervalSeconds, minimum);
  }
};

export const isEntitlementError = (error: unknown): error is EntitlementError =>
  error instanceof EntitlementError;
