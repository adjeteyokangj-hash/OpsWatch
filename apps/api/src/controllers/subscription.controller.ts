import { Response } from "express";
import { z } from "zod";
import type { AuthRequest } from "../middleware/auth";
import { isEntitlementError } from "../services/entitlements/entitlement.service";
import {
  assignSubscriptionPlan,
  getSubscriptionSummary
} from "../services/entitlements/subscription.service";
import type { PlanCode } from "../services/entitlements/plan-definitions";
import {
  createBillingPortalSession,
  createCheckoutSession,
  isStripeConfigured
} from "../services/billing/stripe.service";

export const getOrganizationSubscription = async (req: AuthRequest, res: Response) => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(404).json({ error: "No organization found" });
    return;
  }

  const summary = await getSubscriptionSummary(orgId);
  res.json(summary);
};

export const assignOrganizationSubscription = async (req: AuthRequest, res: Response) => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(404).json({ error: "No organization found" });
    return;
  }

  const schema = z.object({
    planCode: z.enum(["PILOT", "STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"]),
    status: z.enum(["ACTIVE", "TRIAL", "PAST_DUE", "CANCELLED", "SUSPENDED"]).optional(),
    trialEndsAt: z.string().datetime().optional()
  });

  try {
    const body = schema.parse(req.body ?? {});
    const subscription = await assignSubscriptionPlan({
      organizationId: orgId,
      planCode: body.planCode as PlanCode,
      status: body.status,
      trialEndsAt: body.trialEndsAt ? new Date(body.trialEndsAt) : undefined,
      updatedById: typeof req.user?.sub === "string" ? req.user.sub : undefined
    });
    const summary = await getSubscriptionSummary(orgId);
    res.json({ subscription, summary });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: error.flatten() });
      return;
    }
    throw error;
  }
};

export const createSubscriptionCheckout = async (req: AuthRequest, res: Response) => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(404).json({ error: "No organization found" });
    return;
  }

  if (!(await isStripeConfigured())) {
    res.status(503).json({ error: "Stripe billing is not configured on this deployment." });
    return;
  }

  const schema = z.object({
    planCode: z.enum(["PILOT", "STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"]),
    interval: z.enum(["monthly", "annual"]).default("monthly")
  });

  try {
    const body = schema.parse(req.body ?? {});
    const session = await createCheckoutSession({
      organizationId: orgId,
      planCode: body.planCode as PlanCode,
      interval: body.interval,
      email: typeof req.user?.email === "string" ? req.user.email : undefined
    });
    res.json(session);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: error.flatten() });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : "Checkout failed" });
  }
};

export const createSubscriptionPortal = async (req: AuthRequest, res: Response) => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(404).json({ error: "No organization found" });
    return;
  }

  if (!(await isStripeConfigured())) {
    res.status(503).json({ error: "Stripe billing is not configured on this deployment." });
    return;
  }

  try {
    const session = await createBillingPortalSession({ organizationId: orgId });
    res.json(session);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Portal failed" });
  }
};

export const handleEntitlementFailure = (res: Response, error: unknown): boolean => {
  if (!isEntitlementError(error)) return false;
  res.status(error.statusCode).json({
    error: {
      code: error.code,
      message: error.message,
      details: error.details
    }
  });
  return true;
};
