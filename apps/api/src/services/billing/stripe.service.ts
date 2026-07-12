import { randomUUID } from "crypto";
import Stripe from "stripe";
import type { SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../config/logger";
import { seedPlans } from "../entitlements/subscription.service";
import type { PlanCode } from "../entitlements/plan-definitions";

export type BillingInterval = "monthly" | "annual";

export class StripeWebhookProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeWebhookProcessingError";
  }
}

let stripeClient: Stripe | null = null;

export const isStripeConfigured = (): boolean => Boolean(process.env.STRIPE_SECRET_KEY);

export const getStripe = (): Stripe => {
  if (!isStripeConfigured()) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY.");
  }
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY as string);
  }
  return stripeClient;
};

const webBaseUrl = (): string =>
  (process.env.OPSWATCH_WEB_URL || "http://localhost:3000").replace(/\/+$/, "");

const mapStripeStatus = (status: Stripe.Subscription.Status): SubscriptionStatus => {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIAL";
    case "past_due":
      return "PAST_DUE";
    case "unpaid":
      return "UNPAID";
    case "canceled":
      return "CANCELLED";
    case "incomplete":
    case "incomplete_expired":
    case "paused":
    default:
      return "SUSPENDED";
  }
};

const resolvePriceId = (
  plan: { stripePriceMonthlyId: string | null; stripePriceAnnualId: string | null },
  interval: BillingInterval
): string | null => (interval === "annual" ? plan.stripePriceAnnualId : plan.stripePriceMonthlyId);

const findPlanByPriceId = async (priceId: string) =>
  prisma.plan.findFirst({
    where: {
      OR: [{ stripePriceMonthlyId: priceId }, { stripePriceAnnualId: priceId }]
    }
  });

const ensureStripeCustomer = async (input: {
  organizationId: string;
  email?: string;
}): Promise<string> => {
  const stripe = getStripe();
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: input.organizationId }
  });

  if (subscription?.stripeCustomerId) {
    return subscription.stripeCustomerId;
  }

  const organization = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { name: true }
  });

  const customer = await stripe.customers.create({
    email: input.email,
    name: organization?.name ?? undefined,
    metadata: { organizationId: input.organizationId }
  });

  if (subscription) {
    await prisma.subscription.update({
      where: { organizationId: input.organizationId },
      data: { stripeCustomerId: customer.id, updatedAt: new Date() }
    });
  }

  return customer.id;
};

export const createCheckoutSession = async (input: {
  organizationId: string;
  planCode: PlanCode;
  interval: BillingInterval;
  email?: string;
}): Promise<{ url: string; reusedPortal?: boolean }> => {
  await seedPlans();
  const stripe = getStripe();

  const existingSubscription = await prisma.subscription.findUnique({
    where: { organizationId: input.organizationId }
  });

  if (
    existingSubscription?.stripeSubscriptionId &&
    ["ACTIVE", "TRIAL", "PAST_DUE"].includes(existingSubscription.status)
  ) {
    const portal = await createBillingPortalSession({ organizationId: input.organizationId });
    return { url: portal.url, reusedPortal: true };
  }

  const plan = await prisma.plan.findUnique({ where: { code: input.planCode } });
  if (!plan) {
    throw new Error(`Plan not found: ${input.planCode}`);
  }

  const priceId = resolvePriceId(plan, input.interval);
  if (!priceId) {
    throw new Error(
      `Plan ${input.planCode} has no Stripe price configured for the ${input.interval} interval.`
    );
  }

  const customerId = await ensureStripeCustomer({
    organizationId: input.organizationId,
    email: input.email
  });

  const base = webBaseUrl();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${base}/subscription?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/subscription?checkout=cancelled`,
    subscription_data: {
      metadata: { organizationId: input.organizationId, planCode: input.planCode }
    },
    metadata: { organizationId: input.organizationId, planCode: input.planCode }
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }

  return { url: session.url };
};

export const createBillingPortalSession = async (input: {
  organizationId: string;
}): Promise<{ url: string }> => {
  const stripe = getStripe();
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: input.organizationId }
  });

  if (!subscription?.stripeCustomerId) {
    throw new Error("No Stripe customer on file. Start a checkout first.");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${webBaseUrl()}/subscription`
  });

  return { url: session.url };
};

const syncSubscriptionFromStripe = async (stripeSubscription: Stripe.Subscription): Promise<void> => {
  const organizationId =
    stripeSubscription.metadata?.organizationId ??
    (await findOrganizationIdByCustomer(stripeSubscription.customer));

  if (!organizationId) {
    logger.warn("Stripe subscription received without a resolvable organization", {
      stripeSubscriptionId: stripeSubscription.id
    });
    return;
  }

  const item = stripeSubscription.items.data[0];
  const priceId = item?.price?.id ?? null;

  if (priceId) {
    const plan = await findPlanByPriceId(priceId);
    if (!plan) {
      throw new StripeWebhookProcessingError(`Unknown Stripe price ID: ${priceId}`);
    }
  }

  const plan = priceId ? await findPlanByPriceId(priceId) : null;
  const status = mapStripeStatus(stripeSubscription.status);
  const periodStartUnix = item?.current_period_start ?? stripeSubscription.start_date;
  const periodEndUnix = item?.current_period_end ?? null;
  const periodStart = periodStartUnix ? new Date(periodStartUnix * 1000) : null;
  const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000) : null;
  const customerId =
    typeof stripeSubscription.customer === "string"
      ? stripeSubscription.customer
      : stripeSubscription.customer.id;

  const existing = await prisma.subscription.findUnique({ where: { organizationId } });
  const planId = plan?.id ?? existing?.planId;
  if (!planId) {
    throw new StripeWebhookProcessingError(
      `Could not resolve plan for Stripe subscription ${stripeSubscription.id}`
    );
  }

  await prisma.subscription.upsert({
    where: { organizationId },
    update: {
      planId,
      status,
      stripeCustomerId: customerId,
      stripeSubscriptionId: stripeSubscription.id,
      stripePriceId: priceId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      updatedAt: new Date()
    },
    create: {
      id: randomUUID(),
      organizationId,
      planId,
      status,
      stripeCustomerId: customerId,
      stripeSubscriptionId: stripeSubscription.id,
      stripePriceId: priceId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      updatedAt: new Date()
    }
  });
};

const findOrganizationIdByCustomer = async (
  customer: string | Stripe.Customer | Stripe.DeletedCustomer
): Promise<string | null> => {
  const customerId = typeof customer === "string" ? customer : customer.id;
  const subscription = await prisma.subscription.findFirst({
    where: { stripeCustomerId: customerId },
    select: { organizationId: true }
  });
  return subscription?.organizationId ?? null;
};

const markPastDue = async (
  customer: string | Stripe.Customer | Stripe.DeletedCustomer
): Promise<void> => {
  const organizationId = await findOrganizationIdByCustomer(customer);
  if (!organizationId) return;
  await prisma.subscription.updateMany({
    where: { organizationId },
    data: { status: "PAST_DUE", updatedAt: new Date() }
  });
};

export const constructStripeEvent = (rawBody: Buffer, signature: string): Stripe.Event => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
  }
  return getStripe().webhooks.constructEvent(rawBody, signature, secret);
};

const beginWebhookEvent = async (event: Stripe.Event): Promise<{ duplicate: boolean; recordId: string }> => {
  const existing = await prisma.stripeWebhookEvent.findUnique({
    where: { stripeEventId: event.id }
  });
  if (existing?.status === "PROCESSED") {
    return { duplicate: true, recordId: existing.id };
  }
  if (existing) {
    return { duplicate: false, recordId: existing.id };
  }

  const record = await prisma.stripeWebhookEvent.create({
    data: {
      id: randomUUID(),
      stripeEventId: event.id,
      eventType: event.type,
      status: "PROCESSING"
    }
  });
  return { duplicate: false, recordId: record.id };
};

const finishWebhookEvent = async (
  recordId: string,
  status: "PROCESSED" | "FAILED" | "SKIPPED",
  error?: string
): Promise<void> => {
  await prisma.stripeWebhookEvent.update({
    where: { id: recordId },
    data: { status, error: error ?? null, processedAt: new Date() }
  });
};

const processStripeEvent = async (event: Stripe.Event): Promise<void> => {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.subscription) {
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id;
        const stripeSubscription = await getStripe().subscriptions.retrieve(subscriptionId);
        await syncSubscriptionFromStripe(stripeSubscription);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await syncSubscriptionFromStripe(event.data.object as Stripe.Subscription);
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.customer) {
        await markPastDue(invoice.customer);
      }
      break;
    }
    default:
      logger.info(`Unhandled Stripe event type: ${event.type}`);
  }
};

export const handleStripeEvent = async (event: Stripe.Event): Promise<void> => {
  const { duplicate, recordId } = await beginWebhookEvent(event);
  if (duplicate) {
    logger.info(`Skipping duplicate Stripe webhook ${event.id} (${event.type})`);
    return;
  }

  try {
    await processStripeEvent(event);
    await finishWebhookEvent(recordId, "PROCESSED");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishWebhookEvent(recordId, error instanceof StripeWebhookProcessingError ? "SKIPPED" : "FAILED", message);
    throw error;
  }
};
