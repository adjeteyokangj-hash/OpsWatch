import { Response } from "express";
import { z } from "zod";
import type { AuthRequest } from "../middleware/auth";
import { isEntitlementError } from "../services/entitlements/entitlement.service";
import {
  assignSubscriptionPlan,
  getSubscriptionSummary
} from "../services/entitlements/subscription.service";
import type { PlanCode } from "../services/entitlements/plan-definitions";

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
