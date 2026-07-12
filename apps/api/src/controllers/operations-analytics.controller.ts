import { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { hasPermission } from "../auth/permissions";
import { buildOperationsAnalytics } from "../services/operations-analytics.service";

const orgIdOr403 = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

export const getOperationsAnalyticsHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "analytics:view")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const windowDaysRaw = typeof req.query.windowDays === "string" ? Number(req.query.windowDays) : 30;
  const windowDays = Number.isFinite(windowDaysRaw) && windowDaysRaw > 0 ? windowDaysRaw : 30;
  res.json(await buildOperationsAnalytics(orgId, windowDays));
};
