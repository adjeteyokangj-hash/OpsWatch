import { randomUUID } from "crypto";
import Stripe from "stripe";
import type { BillingInterval, BillingStatus, ProjectBilling } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../config/logger";
import { seedPlans } from "../entitlements/subscription.service";
import type { PlanCode } from "../entitlements/plan-definitions";
import { getStripe, webBaseUrl, StripeWebhookProcessingError } from "./stripe.service";

export type CheckoutInterval = "monthly" | "annual";

const toBillingInterval = (interval: CheckoutInterval): BillingInterval =>
  interval === "annual" ? "ANNUAL" : "MONTHLY";

/** Stripe subscription status -> ProjectBilling.billingStatus (no UNPAID in that enum). */
const mapStripeStatusToBilling = (status: Stripe.Subscription.Status): BillingStatus => {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIAL";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
      return "CANCELLED";
    case "unpaid":
    case "incomplete":
    case "incomplete_expired":
    case "paused":
    default:
      return "SUSPENDED";
  }
};

const resolvePlanPriceId = (
  plan: { stripePriceMonthlyId: string | null; stripePriceAnnualId: string | null },
  interval: CheckoutInterval
): string | null => (interval === "annual" ? plan.stripePriceAnnualId : plan.stripePriceMonthlyId);

const findPlanByPriceId = async (priceId: string) =>
  prisma.plan.findFirst({
    where: { OR: [{ stripePriceMonthlyId: priceId }, { stripePriceAnnualId: priceId }] }
  });

const intervalForPrice = (
  plan: { stripePriceMonthlyId: string | null; stripePriceAnnualId: string | null },
  priceId: string | null
): BillingInterval => (priceId && priceId === plan.stripePriceAnnualId ? "ANNUAL" : "MONTHLY");

const projectBillingReturnUrl = (projectId: string, suffix = ""): string =>
  `${webBaseUrl()}/projects/${projectId}/billing${suffix}`;

/**
 * Ensure a ProjectBilling row exists so it can act as the billing source of
 * truth. Does not assign any organisation-level subscription.
 */
const ensureProjectBilling = async (projectId: string): Promise<ProjectBilling> => {
  const existing = await prisma.projectBilling.findUnique({ where: { projectId } });
  if (existing) return existing;
  const now = new Date();
  return prisma.projectBilling.create({
    data: {
      id: randomUUID(),
      projectId,
      plan: "FREE",
      monthlyPrice: 0,
      currency: "GBP",
      billingStatus: "ACTIVE",
      billingStartDate: now,
      updatedAt: now
    }
  });
};

/** Create (or reuse) the Stripe customer bound to this specific application. */
const ensureProjectStripeCustomer = async (input: {
  organizationId: string;
  projectId: string;
  projectBillingId: string;
  existingCustomerId: string | null;
  email?: string;
}): Promise<string> => {
  if (input.existingCustomerId) return input.existingCustomerId;

  const stripe = await getStripe();
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { name: true, clientName: true }
  });

  const customer = await stripe.customers.create({
    email: input.email,
    name: project?.name ?? undefined,
    metadata: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      projectBillingId: input.projectBillingId,
      clientName: project?.clientName ?? ""
    }
  });

  await prisma.projectBilling.update({
    where: { projectId: input.projectId },
    data: { stripeCustomerId: customer.id, updatedAt: new Date() }
  });

  return customer.id;
};

export type ProjectCheckoutResult = { url: string; reusedPortal?: boolean };

/**
 * Application-scoped Stripe checkout. Creates an independent Stripe subscription
 * for this project only, with project metadata attached to both the session and
 * the subscription so webhooks can reconcile the correct ProjectBilling record.
 */
export const createProjectCheckoutSession = async (input: {
  organizationId: string;
  projectId: string;
  planCode: PlanCode;
  interval: CheckoutInterval;
  email?: string;
}): Promise<ProjectCheckoutResult> => {
  await seedPlans();
  const stripe = await getStripe();
  const billing = await ensureProjectBilling(input.projectId);

  // If this application already has a live subscription, send them to the portal
  // (manage), rather than opening a second parallel subscription.
  if (
    billing.stripeSubscriptionId &&
    ["ACTIVE", "TRIAL", "PAST_DUE"].includes(billing.billingStatus)
  ) {
    const portal = await createProjectBillingPortalSession({
      organizationId: input.organizationId,
      projectId: input.projectId
    });
    return { url: portal.url, reusedPortal: true };
  }

  const plan = await prisma.plan.findUnique({ where: { code: input.planCode } });
  if (!plan) {
    throw new Error(`Plan not found: ${input.planCode}`);
  }
  const priceId = resolvePlanPriceId(plan, input.interval);
  if (!priceId) {
    throw new Error(`Plan ${input.planCode} has no Stripe price for the ${input.interval} interval.`);
  }

  const customerId = await ensureProjectStripeCustomer({
    organizationId: input.organizationId,
    projectId: input.projectId,
    projectBillingId: billing.id,
    existingCustomerId: billing.stripeCustomerId,
    email: input.email
  });

  const metadata: Record<string, string> = {
    organizationId: input.organizationId,
    projectId: input.projectId,
    projectBillingId: billing.id,
    planCode: input.planCode,
    billingInterval: toBillingInterval(input.interval)
  };

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: projectBillingReturnUrl(input.projectId, "?checkout=success&session_id={CHECKOUT_SESSION_ID}"),
    cancel_url: projectBillingReturnUrl(input.projectId, "?checkout=cancelled"),
    subscription_data: { metadata },
    metadata
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }
  return { url: session.url };
};

/** Application-scoped billing portal, opened for this application's Stripe customer. */
export const createProjectBillingPortalSession = async (input: {
  organizationId: string;
  projectId: string;
}): Promise<{ url: string }> => {
  const stripe = await getStripe();
  const billing = await prisma.projectBilling.findUnique({ where: { projectId: input.projectId } });
  if (!billing?.stripeCustomerId) {
    throw new Error("No Stripe customer on file for this application. Start a checkout first.");
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: billing.stripeCustomerId,
    return_url: projectBillingReturnUrl(input.projectId)
  });
  return { url: session.url };
};

/**
 * Resolve the ProjectBilling row a Stripe object belongs to, using (in order):
 * projectBillingId metadata, projectId metadata, then the stored Stripe
 * subscription/customer id. Returns null if this is not an application subscription.
 */
const resolveProjectBilling = async (params: {
  metadata?: Stripe.Metadata | null;
  subscriptionId?: string | null;
  customerId?: string | null;
}): Promise<ProjectBilling | null> => {
  const meta = params.metadata ?? {};
  if (meta.projectBillingId) {
    const byId = await prisma.projectBilling.findUnique({ where: { id: String(meta.projectBillingId) } });
    if (byId) return byId;
  }
  if (meta.projectId) {
    const byProject = await prisma.projectBilling.findUnique({
      where: { projectId: String(meta.projectId) }
    });
    if (byProject) return byProject;
  }
  if (params.subscriptionId) {
    const bySub = await prisma.projectBilling.findUnique({
      where: { stripeSubscriptionId: params.subscriptionId }
    });
    if (bySub) return bySub;
  }
  if (params.customerId) {
    const byCustomer = await prisma.projectBilling.findFirst({
      where: { stripeCustomerId: params.customerId }
    });
    if (byCustomer) return byCustomer;
  }
  return null;
};

/**
 * Sync a Stripe subscription into the matching ProjectBilling record only.
 * Returns true if the subscription belongs to an application (and was synced),
 * false if it is not an application subscription (caller may fall back).
 */
export const syncProjectSubscriptionFromStripe = async (
  stripeSubscription: Stripe.Subscription
): Promise<boolean> => {
  const customerId =
    typeof stripeSubscription.customer === "string"
      ? stripeSubscription.customer
      : stripeSubscription.customer.id;

  const billing = await resolveProjectBilling({
    metadata: stripeSubscription.metadata,
    subscriptionId: stripeSubscription.id,
    customerId
  });
  if (!billing) return false;

  const item = stripeSubscription.items.data[0];
  const priceId = item?.price?.id ?? null;
  const productId =
    item && item.price && typeof item.price.product === "string" ? item.price.product : null;

  let planCode: string | null = billing.planCode;
  let monthlyPrice = billing.monthlyPrice;
  let currency = billing.currency;
  let interval: BillingInterval = billing.billingInterval;
  if (priceId) {
    const plan = await findPlanByPriceId(priceId);
    if (!plan) {
      throw new StripeWebhookProcessingError(`Unknown Stripe price ID: ${priceId}`);
    }
    planCode = plan.code;
    monthlyPrice = plan.monthlyPrice;
    currency = plan.currency;
    interval = intervalForPrice(plan, priceId);
  }

  const periodStartUnix = item?.current_period_start ?? stripeSubscription.start_date;
  const periodEndUnix = item?.current_period_end ?? null;

  await prisma.projectBilling.update({
    where: { id: billing.id },
    data: {
      planCode,
      monthlyPrice,
      currency,
      billingInterval: interval,
      billingStatus: mapStripeStatusToBilling(stripeSubscription.status),
      stripeCustomerId: customerId,
      stripeSubscriptionId: stripeSubscription.id,
      stripePriceId: priceId,
      stripeProductId: productId,
      currentPeriodStart: periodStartUnix ? new Date(periodStartUnix * 1000) : null,
      currentPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000) : null,
      renewalDate: periodEndUnix ? new Date(periodEndUnix * 1000) : billing.renewalDate,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      trialEndsAt: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
      updatedAt: new Date()
    }
  });
  return true;
};

/** invoice.paid -> mark the matching application paid. Returns true if handled. */
export const recordProjectInvoicePaid = async (invoice: Stripe.Invoice): Promise<boolean> => {
  const subscriptionId =
    typeof (invoice as { subscription?: unknown }).subscription === "string"
      ? ((invoice as { subscription?: string }).subscription ?? null)
      : null;
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
  const billing = await resolveProjectBilling({ subscriptionId, customerId });
  if (!billing) return false;

  await prisma.projectBilling.update({
    where: { id: billing.id },
    data: {
      lastPaymentAt: new Date(),
      latestInvoiceId: invoice.id ?? billing.latestInvoiceId,
      billingStatus: billing.billingStatus === "PAST_DUE" ? "ACTIVE" : billing.billingStatus,
      updatedAt: new Date()
    }
  });
  return true;
};

/** invoice.payment_failed -> mark the matching application past due. Returns true if handled. */
export const markProjectPaymentFailed = async (invoice: Stripe.Invoice): Promise<boolean> => {
  const subscriptionId =
    typeof (invoice as { subscription?: unknown }).subscription === "string"
      ? ((invoice as { subscription?: string }).subscription ?? null)
      : null;
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
  const billing = await resolveProjectBilling({ subscriptionId, customerId });
  if (!billing) return false;

  await prisma.projectBilling.update({
    where: { id: billing.id },
    data: { billingStatus: "PAST_DUE", updatedAt: new Date() }
  });
  return true;
};

/** List Stripe invoices for this application's customer (real, Stripe-backed). */
export const listProjectInvoices = async (projectId: string): Promise<Array<{
  id: string;
  number: string | null;
  status: string | null;
  amountDue: number;
  amountPaid: number;
  currency: string;
  created: string;
  periodStart: string | null;
  periodEnd: string | null;
  hostedInvoiceUrl: string | null;
  pdfUrl: string | null;
}>> => {
  const billing = await prisma.projectBilling.findUnique({ where: { projectId } });
  if (!billing?.stripeCustomerId) return [];
  const stripe = await getStripe();
  const invoices = await stripe.invoices.list({ customer: billing.stripeCustomerId, limit: 24 });
  return invoices.data.map((invoice) => ({
    id: invoice.id ?? "",
    number: invoice.number ?? null,
    status: invoice.status ?? null,
    amountDue: (invoice.amount_due ?? 0) / 100,
    amountPaid: (invoice.amount_paid ?? 0) / 100,
    currency: (invoice.currency ?? "gbp").toUpperCase(),
    created: new Date((invoice.created ?? 0) * 1000).toISOString(),
    periodStart: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
    periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    pdfUrl: invoice.invoice_pdf ?? null
  }));
};

/** Whether a Stripe object is an application subscription (for webhook routing). */
export const isProjectStripeObject = async (params: {
  metadata?: Stripe.Metadata | null;
  subscriptionId?: string | null;
  customerId?: string | null;
}): Promise<boolean> => {
  const meta = params.metadata ?? {};
  if (meta.projectId || meta.projectBillingId) return true;
  const billing = await resolveProjectBilling(params);
  if (billing) {
    logger.debug("Resolved project billing for Stripe object", { projectBillingId: billing.id });
    return true;
  }
  return false;
};
