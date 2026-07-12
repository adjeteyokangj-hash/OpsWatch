import "dotenv/config";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import type { PlanCode } from "../src/services/entitlements/plan-definitions";

const prisma = new PrismaClient();

type Interval = "monthly" | "annual";

type PriceBinding = {
  planCode: PlanCode;
  interval: Interval;
  envKey: string;
  priceId: string | undefined;
};

const PLAN_BINDINGS: Array<{ planCode: PlanCode; monthlyEnv: string; annualEnv: string }> = [
  { planCode: "PILOT", monthlyEnv: "STRIPE_PRICE_PILOT_MONTHLY", annualEnv: "STRIPE_PRICE_PILOT_ANNUAL" },
  { planCode: "GROWTH", monthlyEnv: "STRIPE_PRICE_GROWTH_MONTHLY", annualEnv: "STRIPE_PRICE_GROWTH_ANNUAL" },
  { planCode: "BUSINESS", monthlyEnv: "STRIPE_PRICE_BUSINESS_MONTHLY", annualEnv: "STRIPE_PRICE_BUSINESS_ANNUAL" },
  {
    planCode: "ENTERPRISE",
    monthlyEnv: "STRIPE_PRICE_ENTERPRISE_MONTHLY",
    annualEnv: "STRIPE_PRICE_ENTERPRISE_ANNUAL"
  }
];

const maskPriceId = (priceId: string): string =>
  priceId.length <= 8 ? priceId : `${priceId.slice(0, 4)}…${priceId.slice(-4)}`;

const expectedInterval = (interval: Interval): Stripe.Price.Recurring.Interval =>
  interval === "monthly" ? "month" : "year";

const loadBindings = (): PriceBinding[] => {
  const bindings: PriceBinding[] = [];
  for (const row of PLAN_BINDINGS) {
    bindings.push({
      planCode: row.planCode,
      interval: "monthly",
      envKey: row.monthlyEnv,
      priceId: process.env[row.monthlyEnv]?.trim() || undefined
    });
    bindings.push({
      planCode: row.planCode,
      interval: "annual",
      envKey: row.annualEnv,
      priceId: process.env[row.annualEnv]?.trim() || undefined
    });
  }
  return bindings;
};

const validateStripePrice = async (
  stripe: Stripe,
  binding: PriceBinding,
  plan: { currency: string; monthlyPrice: number; annualPrice: number | null }
): Promise<{ field: "stripePriceMonthlyId" | "stripePriceAnnualId"; priceId: string }> => {
  if (!binding.priceId) {
    throw new Error(`Missing ${binding.envKey} for ${binding.planCode} (${binding.interval})`);
  }

  const price = await stripe.prices.retrieve(binding.priceId, { expand: ["product"] });
  if (!price.active) {
    throw new Error(`Stripe price ${maskPriceId(binding.priceId)} is not active`);
  }
  if (!price.recurring) {
    throw new Error(`Stripe price ${maskPriceId(binding.priceId)} is not recurring`);
  }
  if (price.recurring.interval !== expectedInterval(binding.interval)) {
    throw new Error(
      `Stripe price ${maskPriceId(binding.priceId)} interval ${price.recurring.interval} does not match ${binding.interval}`
    );
  }

  const currency = price.currency.toUpperCase();
  if (currency !== plan.currency.toUpperCase()) {
    throw new Error(
      `Stripe price ${maskPriceId(binding.priceId)} currency ${currency} does not match plan currency ${plan.currency}`
    );
  }

  const expectedAmount =
    binding.interval === "monthly" ? plan.monthlyPrice : plan.annualPrice ?? plan.monthlyPrice * 12;
  const actualAmount = (price.unit_amount ?? 0) / 100;
  if (Math.abs(actualAmount - expectedAmount) > 0.01) {
    throw new Error(
      `Stripe price ${maskPriceId(binding.priceId)} amount ${actualAmount} does not match plan amount ${expectedAmount} for ${binding.planCode} ${binding.interval}`
    );
  }

  const product = price.product;
  if (typeof product !== "string" && "deleted" in product && product.deleted) {
    throw new Error(`Stripe product for ${maskPriceId(binding.priceId)} is deleted`);
  }
  if (typeof product !== "string" && !product.active) {
    throw new Error(`Stripe product for ${maskPriceId(binding.priceId)} is not active`);
  }

  return {
    field: binding.interval === "monthly" ? "stripePriceMonthlyId" : "stripePriceAnnualId",
    priceId: binding.priceId
  };
};

export const syncStripePrices = async (): Promise<void> => {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error("STRIPE_SECRET_KEY is required");
  }

  const stripe = new Stripe(secret);
  const bindings = loadBindings().filter((row) => row.priceId);
  if (bindings.length === 0) {
    console.log("No Stripe price IDs supplied. Set STRIPE_PRICE_* env vars and retry.");
    return;
  }

  const summary: Array<{ planCode: string; interval: string; priceId: string; action: string }> = [];

  for (const binding of bindings) {
    const plan = await prisma.plan.findUnique({ where: { code: binding.planCode } });
    if (!plan) {
      throw new Error(`Plan not found: ${binding.planCode}`);
    }

    const validated = await validateStripePrice(stripe, binding, plan);
    const current =
      validated.field === "stripePriceMonthlyId" ? plan.stripePriceMonthlyId : plan.stripePriceAnnualId;

    if (current === validated.priceId) {
      summary.push({
        planCode: binding.planCode,
        interval: binding.interval,
        priceId: maskPriceId(validated.priceId),
        action: "unchanged"
      });
      continue;
    }

    if (current && current !== validated.priceId) {
      throw new Error(
        `Refusing to overwrite ${binding.planCode} ${binding.interval} price (${maskPriceId(current)} -> ${maskPriceId(validated.priceId)}). Clear the plan field manually if intentional.`
      );
    }

    await prisma.plan.update({
      where: { id: plan.id },
      data: { [validated.field]: validated.priceId, updatedAt: new Date() }
    });

    summary.push({
      planCode: binding.planCode,
      interval: binding.interval,
      priceId: maskPriceId(validated.priceId),
      action: "updated"
    });
  }

  console.log("Stripe price sync complete:");
  for (const row of summary) {
    console.log(`- ${row.planCode} ${row.interval}: ${row.priceId} (${row.action})`);
  }
};

void syncStripePrices()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
