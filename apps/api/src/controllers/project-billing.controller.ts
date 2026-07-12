import { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { hasPermission } from "../auth/permissions";
import { prisma } from "../lib/prisma";
import { getProjectBilling, updateProjectBilling } from "../services/project-billing.service";

const orgIdOr403 = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

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
  await updateProjectBilling({
    projectId: project.id,
    plan: body.plan,
    monthlyPrice: typeof body.monthlyPrice === "number" ? body.monthlyPrice : undefined,
    currency: typeof body.currency === "string" ? body.currency : undefined,
    billingStatus: body.billingStatus,
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
