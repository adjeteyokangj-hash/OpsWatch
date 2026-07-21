import { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { hasPermission } from "../auth/permissions";
import { prisma } from "../lib/prisma";
import { getProjectBilling, updateProjectBilling } from "../services/project-billing.service";
import { isStripeConfigured } from "../services/billing/stripe.service";
import {
  createProjectCheckoutSession,
  createProjectBillingPortalSession,
  listProjectInvoices,
  type CheckoutInterval
} from "../services/billing/project-stripe.service";
import type { PlanCode } from "../services/entitlements/plan-definitions";

const PLAN_CODES: PlanCode[] = ["PILOT", "STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"];

const orgIdOr403 = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

/**
 * Validate the project belongs to the caller's organisation (404 otherwise) and
 * that the caller may manage billing. Returns the project id or null (response sent).
 */
const requireManageableProject = async (req: AuthRequest, res: Response): Promise<string | null> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return null;
  if (!hasPermission(req.user?.role, "policy:manage")) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  const project = await prisma.project.findFirst({
    where: { id: req.params.projectId, organizationId: orgId },
    select: { id: true }
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  return project.id;
};

const normalizeInterval = (value: unknown): CheckoutInterval =>
  value === "ANNUAL" || value === "annual" ? "annual" : "monthly";

export const getProjectBillingHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;

  const project = await prisma.project.findFirst({
    where: { id: req.params.projectId, organizationId: orgId },
    select: { id: true }
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const billing = await getProjectBilling(project.id, {
    includeInternalNotes: hasPermission(req.user?.role, "policy:manage")
  });
  if (!billing) {
    res.status(404).json({ error: "Project billing not configured" });
    return;
  }
  res.json(billing);
};

export const updateProjectBillingHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "policy:manage")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const project = await prisma.project.findFirst({
    where: { id: req.params.projectId, organizationId: orgId },
    select: { id: true }
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const body = req.body ?? {};
  const billingInterval =
    body.billingInterval === "MONTHLY" || body.billingInterval === "ANNUAL" ? body.billingInterval : undefined;
  const paymentMethod =
    body.paymentMethod === null
      ? null
      : body.paymentMethod && typeof body.paymentMethod === "object"
        ? {
            brand: typeof body.paymentMethod.brand === "string" ? body.paymentMethod.brand : undefined,
            last4:
              typeof body.paymentMethod.last4 === "string" || body.paymentMethod.last4 === null
                ? body.paymentMethod.last4
                : undefined,
            expMonth:
              typeof body.paymentMethod.expMonth === "number" || body.paymentMethod.expMonth === null
                ? body.paymentMethod.expMonth
                : undefined,
            expYear:
              typeof body.paymentMethod.expYear === "number" || body.paymentMethod.expYear === null
                ? body.paymentMethod.expYear
                : undefined
          }
        : undefined;
  await updateProjectBilling({
    projectId: project.id,
    plan: body.plan,
    monthlyPrice: typeof body.monthlyPrice === "number" ? body.monthlyPrice : undefined,
    currency: typeof body.currency === "string" ? body.currency : undefined,
    billingStatus: body.billingStatus,
    billingInterval,
    paymentMethod,
    billingStartDate: body.billingStartDate ? new Date(body.billingStartDate) : undefined,
    renewalDate: body.renewalDate ? new Date(body.renewalDate) : body.renewalDate === null ? null : undefined,
    dataRetentionDays: typeof body.dataRetentionDays === "number" ? body.dataRetentionDays : undefined,
    checkLimit: typeof body.checkLimit === "number" || body.checkLimit === null ? body.checkLimit : undefined,
    userLimit: typeof body.userLimit === "number" || body.userLimit === null ? body.userLimit : undefined,
    automationRunLimit:
      typeof body.automationRunLimit === "number" || body.automationRunLimit === null ? body.automationRunLimit : undefined,
    customLimits: body.customLimits,
    internalNotes: body.internalNotes,
    updatedById: typeof req.user?.sub === "string" ? req.user.sub : undefined
  });

  res.json(
    await getProjectBilling(project.id, {
      includeInternalNotes: true
    })
  );
};

export const createProjectCheckoutHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const projectId = await requireManageableProject(req, res);
  if (!projectId) return;

  if (!(await isStripeConfigured())) {
    res.status(503).json({ error: "Stripe billing is not configured on this deployment." });
    return;
  }

  const body = req.body ?? {};
  const planCode = body.planCode as PlanCode;
  if (!PLAN_CODES.includes(planCode)) {
    res.status(400).json({ error: "A valid planCode is required." });
    return;
  }

  try {
    const session = await createProjectCheckoutSession({
      organizationId: req.user!.organizationId!,
      projectId,
      planCode,
      interval: normalizeInterval(body.billingInterval ?? body.interval),
      email: typeof req.user?.email === "string" ? req.user.email : undefined
    });
    res.json(session);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Checkout failed" });
  }
};

export const createProjectPortalHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const projectId = await requireManageableProject(req, res);
  if (!projectId) return;

  if (!(await isStripeConfigured())) {
    res.status(503).json({ error: "Stripe billing is not configured on this deployment." });
    return;
  }

  try {
    const session = await createProjectBillingPortalSession({
      organizationId: req.user!.organizationId!,
      projectId
    });
    res.json(session);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Portal failed" });
  }
};

export const listBillingPlansHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  const project = await prisma.project.findFirst({
    where: { id: req.params.projectId, organizationId: orgId },
    select: { id: true }
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const [plans, stripeConfigured] = await Promise.all([
    prisma.plan.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: {
        code: true,
        name: true,
        monthlyPrice: true,
        annualPrice: true,
        currency: true,
        stripePriceMonthlyId: true,
        stripePriceAnnualId: true
      }
    }),
    isStripeConfigured()
  ]);
  res.json({
    stripeConfigured,
    plans: plans.map((plan) => ({
      code: plan.code,
      name: plan.name,
      monthlyPrice: plan.monthlyPrice,
      annualPrice: plan.annualPrice,
      currency: plan.currency,
      hasMonthlyPrice: Boolean(plan.stripePriceMonthlyId),
      hasAnnualPrice: Boolean(plan.stripePriceAnnualId)
    }))
  });
};

export const listProjectInvoicesHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  const project = await prisma.project.findFirst({
    where: { id: req.params.projectId, organizationId: orgId },
    select: { id: true }
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (!(await isStripeConfigured())) {
    res.json({ invoices: [], stripeConfigured: false });
    return;
  }
  try {
    const invoices = await listProjectInvoices(project.id);
    res.json({ invoices, stripeConfigured: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to load invoices" });
  }
};
