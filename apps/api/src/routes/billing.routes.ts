import { Router } from "express";
import { z } from "zod";
import { getBillingInfo, upgradePlan } from "../services/billing.service";
import { AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/require-role";

export const billingRouter = Router();

billingRouter.get("/billing", async (req: AuthRequest, res) => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(404).json({ error: "No organization found" });
    return;
  }

  const info = await getBillingInfo(orgId);
  res.json(info);
});

billingRouter.post("/billing/upgrade", requireRole("ADMIN"), async (req: AuthRequest, res) => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(404).json({ error: "No organization found" });
    return;
  }

  const schema = z.object({ plan: z.enum(["FREE", "STARTER", "PRO", "ENTERPRISE"]) });
  const { plan } = schema.parse(req.body);
  const result = await upgradePlan(orgId, plan);
  res.json(result);
});
