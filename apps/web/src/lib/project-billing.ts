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

export type BillingInterval = "MONTHLY" | "ANNUAL";

export type PaymentMethod = {
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  updatedAt?: string | null;
};

export type BillingInvoice = {
  id: string;
  number: string;
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
  amount: number;
  currency: string;
  status: "PAID" | "DUE" | "UPCOMING";
};

export const intervalMonths = (interval: BillingInterval): number => (interval === "ANNUAL" ? 12 : 1);

export const intervalPrice = (monthlyPrice: number, interval: BillingInterval): number =>
  interval === "ANNUAL" ? monthlyPrice * 12 : monthlyPrice;

export const formatInterval = (interval: BillingInterval): string =>
  interval === "ANNUAL" ? "Annual" : "Monthly";

export const intervalSuffix = (interval: BillingInterval): string =>
  interval === "ANNUAL" ? "/ year" : "/ month";

export const formatMoney = (amount: number, currency: string): string => {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
};

export const formatBillingDate = (value?: string | null): string => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export const formatPaymentMethod = (payment?: PaymentMethod | null): string => {
  if (!payment || (!payment.brand && !payment.last4)) {
    return "No payment method on file";
  }
  const brand = payment.brand?.trim() || "Card";
  const tail = payment.last4 ? ` •••• ${payment.last4}` : "";
  const exp =
    payment.expMonth && payment.expYear
      ? ` · expires ${String(payment.expMonth).padStart(2, "0")}/${payment.expYear}`
      : "";
  return `${brand}${tail}${exp}`;
};

const addMonths = (date: Date, months: number): Date => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};

/**
 * Derive the invoice / billing-history list from the application's real billing
 * configuration: an invoice is issued at the start of each billing period since
 * the billing start date. Amounts reflect the plan price for the chosen interval.
 */
export const computeInvoices = (input: {
  monthlyPrice: number;
  currency: string;
  interval: BillingInterval;
  billingStartDate?: string | null;
  renewalDate?: string | null;
  billingStatus?: string;
  maxPeriods?: number;
}): BillingInvoice[] => {
  const amount = intervalPrice(input.monthlyPrice, input.interval);
  if (amount <= 0 || !input.billingStartDate) return [];

  const start = new Date(input.billingStartDate);
  if (Number.isNaN(start.getTime())) return [];

  const now = new Date();
  const months = intervalMonths(input.interval);
  const maxPeriods = input.maxPeriods ?? 12;
  // Only healthy subscriptions surface a forward-dated upcoming invoice.
  const showUpcoming =
    input.billingStatus === undefined ||
    input.billingStatus === "ACTIVE" ||
    input.billingStatus === "TRIAL";

  const starts: Date[] = [];
  let cursor = new Date(start);
  let guard = 0;
  while (cursor <= now && guard < 600) {
    starts.push(new Date(cursor));
    cursor = addMonths(cursor, months);
    guard += 1;
  }
  if (starts.length === 0) return [];

  const nextStart = new Date(cursor);
  const invoices: BillingInvoice[] = [];

  // Upcoming invoice for the next period (only for healthy subscriptions).
  if (showUpcoming) {
    const dueDate = input.renewalDate ? new Date(input.renewalDate) : nextStart;
    const periodEnd = addMonths(nextStart, months);
    invoices.push({
      id: invoiceId(nextStart),
      number: invoiceNumber(nextStart),
      periodStart: nextStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      issuedAt: (Number.isNaN(dueDate.getTime()) ? nextStart : dueDate).toISOString(),
      amount,
      currency: input.currency,
      status: "UPCOMING"
    });
  }

  const recentStarts = starts.slice(-maxPeriods);
  for (let i = recentStarts.length - 1; i >= 0; i -= 1) {
    const periodStart = recentStarts[i];
    if (!periodStart) continue;
    const periodEnd = addMonths(periodStart, months);
    const isLatestBilled = i === recentStarts.length - 1;
    const status: BillingInvoice["status"] =
      isLatestBilled && input.billingStatus === "PAST_DUE" ? "DUE" : "PAID";
    invoices.push({
      id: invoiceId(periodStart),
      number: invoiceNumber(periodStart),
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      issuedAt: periodStart.toISOString(),
      amount,
      currency: input.currency,
      status
    });
  }

  return invoices;
};

const invoiceId = (periodStart: Date): string =>
  `${periodStart.getFullYear()}${String(periodStart.getMonth() + 1).padStart(2, "0")}${String(
    periodStart.getDate()
  ).padStart(2, "0")}`;

const invoiceNumber = (periodStart: Date): string =>
  `INV-${periodStart.getFullYear()}${String(periodStart.getMonth() + 1).padStart(2, "0")}`;
