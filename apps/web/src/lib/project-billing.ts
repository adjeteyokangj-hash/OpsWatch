export type BillingPlanId = "FREE" | "STARTER" | "PRO" | "ENTERPRISE" | "CUSTOM";

export type AllowanceLimit = number | null;

export type PlanDefaults = {
  monthlyPrice: number;
  currency: string;
  dataRetentionDays: number;
  checkLimit: AllowanceLimit;
  userLimit: AllowanceLimit;
  automationRunLimit: AllowanceLimit;
};

export const PLAN_DEFAULTS: Record<BillingPlanId, PlanDefaults> = {
  FREE: { monthlyPrice: 0, currency: "GBP", dataRetentionDays: 7, checkLimit: 10, userLimit: 2, automationRunLimit: 20 },
  STARTER: { monthlyPrice: 29, currency: "GBP", dataRetentionDays: 30, checkLimit: 50, userLimit: 5, automationRunLimit: 50 },
  PRO: { monthlyPrice: 99, currency: "GBP", dataRetentionDays: 90, checkLimit: 200, userLimit: 20, automationRunLimit: 100 },
  ENTERPRISE: { monthlyPrice: 499, currency: "GBP", dataRetentionDays: 365, checkLimit: null, userLimit: null, automationRunLimit: null },
  CUSTOM: { monthlyPrice: 0, currency: "GBP", dataRetentionDays: 90, checkLimit: 200, userLimit: 20, automationRunLimit: 100 }
};

/** Legacy rows may still contain 9999 until migration runs. */
export const normalizeAllowanceLimit = (limit: number | null | undefined): AllowanceLimit => {
  if (limit == null) return null;
  if (limit >= 9999) return null;
  return limit;
};

export const isUnlimitedAllowance = (limit: AllowanceLimit | undefined): boolean => limit == null;

export const formatAllowance = (used: number, limit: AllowanceLimit | undefined): string => {
  if (isUnlimitedAllowance(limit)) return `${used} used · Unlimited`;
  return `${used} of ${limit} used`;
};

export const usagePercent = (used: number, limit: AllowanceLimit | undefined): number | null => {
  if (isUnlimitedAllowance(limit) || !limit || limit <= 0) return null;
  return Math.min(100, Math.round((used / limit) * 100));
};

const limitsMatch = (a: AllowanceLimit, b: AllowanceLimit): boolean => {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a === b;
};

export const billingMatchesPlanDefaults = (plan: BillingPlanId, row: PlanDefaults): boolean => {
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

export const resolvePricingLabel = (plan: BillingPlanId, row: PlanDefaults): BillingPlanId => {
  if (plan === "CUSTOM") return "CUSTOM";
  return billingMatchesPlanDefaults(plan, row) ? plan : "CUSTOM";
};

export const applyPlanDefaults = (plan: BillingPlanId): PlanDefaults => ({ ...PLAN_DEFAULTS[plan] });

export const formatPlanLabel = (plan: string): string => {
  if (plan === "CUSTOM") return "Custom";
  return plan.charAt(0) + plan.slice(1).toLowerCase();
};

export const formatPrice = (monthlyPrice: number, currency: string): string => {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : "";
  return `${symbol}${monthlyPrice}`;
};

export type AllowanceFieldKey = "checkLimit" | "userLimit" | "automationRunLimit";

export const allowanceFieldLabel: Record<AllowanceFieldKey, string> = {
  checkLimit: "Check allowance",
  userLimit: "User allowance",
  automationRunLimit: "Automation allowance"
};
