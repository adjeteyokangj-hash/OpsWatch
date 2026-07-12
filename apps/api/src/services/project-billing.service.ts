import { randomUUID } from "crypto";
import type { BillingPlanType, BillingStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";

export type AllowanceLimit = number | null;

export type PlanDefaultShape = {
  monthlyPrice: number;
  currency: string;
  dataRetentionDays: number;
  checkLimit: AllowanceLimit;
  userLimit: AllowanceLimit;
  automationRunLimit: AllowanceLimit;
};

export const PLAN_DEFAULTS: Record<BillingPlanType, PlanDefaultShape> = {
  FREE: { monthlyPrice: 0, currency: "GBP", dataRetentionDays: 7, checkLimit: 10, userLimit: 2, automationRunLimit: 20 },
  STARTER: { monthlyPrice: 29, currency: "GBP", dataRetentionDays: 30, checkLimit: 50, userLimit: 5, automationRunLimit: 50 },
  PRO: { monthlyPrice: 99, currency: "GBP", dataRetentionDays: 90, checkLimit: 200, userLimit: 20, automationRunLimit: 100 },
  ENTERPRISE: { monthlyPrice: 499, currency: "GBP", dataRetentionDays: 365, checkLimit: null, userLimit: null, automationRunLimit: null },
  CUSTOM: { monthlyPrice: 0, currency: "GBP", dataRetentionDays: 90, checkLimit: 200, userLimit: 20, automationRunLimit: 100 }
};

export const normalizeAllowanceLimit = (limit: number | null | undefined): AllowanceLimit => {
  if (limit == null) return null;
  if (limit >= 9999) return null;
  return limit;
};

export const isUnlimitedAllowance = (limit: AllowanceLimit | undefined): boolean => limit == null;

type BillingLimits = PlanDefaultShape;

const limitsMatch = (a: AllowanceLimit, b: AllowanceLimit): boolean => {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a === b;
};

export const billingMatchesPlanDefaults = (plan: BillingPlanType, row: BillingLimits): boolean => {
  if (plan === "CUSTOM") return false;
  const defaults = PLAN_DEFAULTS[plan];
  return (
    row.monthlyPrice === defaults.monthlyPrice &&
    row.currency === defaults.currency &&
    row.dataRetentionDays === defaults.dataRetentionDays &&
    limitsMatch(normalizeAllowanceLimit(row.checkLimit), defaults.checkLimit) &&
    limitsMatch(normalizeAllowanceLimit(row.userLimit), defaults.userLimit) &&
    limitsMatch(normalizeAllowanceLimit(row.automationRunLimit), defaults.automationRunLimit)
  );
};

export const resolvePricingLabel = (plan: BillingPlanType, row: BillingLimits): BillingPlanType => {
  if (plan === "CUSTOM") return "CUSTOM";
  return billingMatchesPlanDefaults(plan, row) ? plan : "CUSTOM";
};

const serializeBillingRow = (billing: {
  plan: BillingPlanType;
  monthlyPrice: number;
  currency: string;
  dataRetentionDays: number;
  checkLimit: number | null;
  userLimit: number | null;
  automationRunLimit: number | null;
  [key: string]: unknown;
}) => ({
  ...billing,
  checkLimit: normalizeAllowanceLimit(billing.checkLimit),
  userLimit: normalizeAllowanceLimit(billing.userLimit),
  automationRunLimit: normalizeAllowanceLimit(billing.automationRunLimit)
});

export const createDefaultProjectBilling = async (projectId: string, plan: BillingPlanType = "FREE") => {
  const defaults = PLAN_DEFAULTS[plan];
  const now = new Date();
  return prisma.projectBilling.create({
    data: {
      id: randomUUID(),
      projectId,
      plan,
      monthlyPrice: defaults.monthlyPrice,
      currency: defaults.currency,
      billingStatus: "ACTIVE",
      billingStartDate: now,
      dataRetentionDays: defaults.dataRetentionDays,
      checkLimit: defaults.checkLimit,
      userLimit: defaults.userLimit,
      automationRunLimit: defaults.automationRunLimit,
      updatedAt: now
    }
  });
};

export const getProjectBilling = async (projectId: string, options?: { includeInternalNotes?: boolean }) => {
  const billing = await prisma.projectBilling.findUnique({
    where: { projectId },
    include: {
      Project: {
        select: { id: true, name: true, clientName: true, environment: true, organizationId: true }
      }
    }
  });
  if (!billing) return null;

  const project = billing.Project;
  const normalized = serializeBillingRow(billing);

  const [checkCount, automationRunCount, userCount] = await Promise.all([
    prisma.check.count({ where: { Service: { projectId } } }),
    prisma.automationRun.count({ where: { projectId } }),
    project ? prisma.user.count({ where: { organizationId: project.organizationId } }) : Promise.resolve(0)
  ]);

  const pricingLabel = resolvePricingLabel(normalized.plan, normalized);

  const { Project: _project, internalNotes, ...billingFields } = billing;

  const payload = {
    ...billingFields,
    ...normalized,
    pricingLabel,
    isCustomPricing: pricingLabel === "CUSTOM",
    project: project
      ? {
          id: project.id,
          name: project.name,
          clientName: project.clientName,
          environment: project.environment
        }
      : undefined,
    usage: {
      checks: checkCount,
      automationRuns: automationRunCount,
      users: userCount
    }
  };

  if (options?.includeInternalNotes) {
    return { ...payload, internalNotes };
  }

  return payload;
};

export const updateProjectBilling = async (input: {
  projectId: string;
  plan?: BillingPlanType;
  monthlyPrice?: number;
  currency?: string;
  billingStatus?: BillingStatus;
  billingStartDate?: Date | null;
  renewalDate?: Date | null;
  dataRetentionDays?: number;
  checkLimit?: number | null;
  userLimit?: number | null;
  automationRunLimit?: number | null;
  customLimits?: Record<string, unknown> | null;
  internalNotes?: string | null;
  updatedById?: string;
}) => {
  const existing = await prisma.projectBilling.findUnique({ where: { projectId: input.projectId } });
  const now = new Date();

  let plan = input.plan ?? existing?.plan ?? "FREE";
  let monthlyPrice = input.monthlyPrice;
  let currency = input.currency;
  let dataRetentionDays = input.dataRetentionDays;
  let checkLimit = input.checkLimit !== undefined ? normalizeAllowanceLimit(input.checkLimit) : undefined;
  let userLimit = input.userLimit !== undefined ? normalizeAllowanceLimit(input.userLimit) : undefined;
  let automationRunLimit =
    input.automationRunLimit !== undefined ? normalizeAllowanceLimit(input.automationRunLimit) : undefined;

  if (input.plan && input.plan !== "CUSTOM" && input.plan !== existing?.plan) {
    const defaults = PLAN_DEFAULTS[input.plan];
    monthlyPrice = defaults.monthlyPrice;
    currency = defaults.currency;
    dataRetentionDays = defaults.dataRetentionDays;
    checkLimit = defaults.checkLimit;
    userLimit = defaults.userLimit;
    automationRunLimit = defaults.automationRunLimit;
    plan = input.plan;
  }

  const merged: BillingLimits = {
    monthlyPrice: monthlyPrice ?? existing?.monthlyPrice ?? PLAN_DEFAULTS.FREE.monthlyPrice,
    currency: currency ?? existing?.currency ?? PLAN_DEFAULTS.FREE.currency,
    dataRetentionDays: dataRetentionDays ?? existing?.dataRetentionDays ?? PLAN_DEFAULTS.FREE.dataRetentionDays,
    checkLimit: checkLimit !== undefined ? checkLimit : normalizeAllowanceLimit(existing?.checkLimit ?? PLAN_DEFAULTS.FREE.checkLimit),
    userLimit: userLimit !== undefined ? userLimit : normalizeAllowanceLimit(existing?.userLimit ?? PLAN_DEFAULTS.FREE.userLimit),
    automationRunLimit:
      automationRunLimit !== undefined
        ? automationRunLimit
        : normalizeAllowanceLimit(existing?.automationRunLimit ?? PLAN_DEFAULTS.FREE.automationRunLimit)
  };

  if (plan !== "CUSTOM" && !billingMatchesPlanDefaults(plan, merged)) {
    plan = "CUSTOM";
  }

  const row = existing
    ? await prisma.projectBilling.update({
        where: { projectId: input.projectId },
        data: {
          plan,
          monthlyPrice: merged.monthlyPrice,
          currency: merged.currency,
          ...(input.billingStatus !== undefined ? { billingStatus: input.billingStatus } : {}),
          ...(input.billingStartDate !== undefined ? { billingStartDate: input.billingStartDate } : {}),
          ...(input.renewalDate !== undefined ? { renewalDate: input.renewalDate } : {}),
          dataRetentionDays: merged.dataRetentionDays,
          checkLimit: merged.checkLimit,
          userLimit: merged.userLimit,
          automationRunLimit: merged.automationRunLimit,
          ...(input.customLimits !== undefined ? { customLimits: input.customLimits as object } : {}),
          ...(input.internalNotes !== undefined ? { internalNotes: input.internalNotes } : {}),
          updatedAt: now
        }
      })
    : await prisma.projectBilling.create({
        data: {
          id: randomUUID(),
          projectId: input.projectId,
          plan,
          monthlyPrice: merged.monthlyPrice,
          currency: merged.currency,
          billingStatus: input.billingStatus ?? "ACTIVE",
          billingStartDate: input.billingStartDate ?? now,
          renewalDate: input.renewalDate ?? null,
          dataRetentionDays: merged.dataRetentionDays,
          checkLimit: merged.checkLimit,
          userLimit: merged.userLimit,
          automationRunLimit: merged.automationRunLimit,
          customLimits: input.customLimits as object | undefined,
          internalNotes: input.internalNotes ?? null,
          updatedAt: now
        }
      });

  if (input.updatedById) {
    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        userId: input.updatedById,
        action: "PROJECT_BILLING_UPDATED",
        entityType: "PROJECT_BILLING",
        entityId: row.id,
        metadataJson: {
          projectId: input.projectId,
          plan: row.plan,
          monthlyPrice: row.monthlyPrice,
          billingStatus: row.billingStatus,
          checkLimit: row.checkLimit,
          userLimit: row.userLimit,
          automationRunLimit: row.automationRunLimit
        }
      }
    });
  }

  return row;
};
