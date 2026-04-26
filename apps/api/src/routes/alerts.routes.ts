import { Router } from "express";
import {
  acknowledgeAlert,
  getAlertById,
  getAlerts,
  resolveAlert
} from "../controllers/alerts.controller";
import { requireApiKeyReadScope, requireAuth } from "../middleware/auth";

export const alertsRouter = Router();

alertsRouter.get("/alerts", requireApiKeyReadScope(["alerts:read"], "projectId"), getAlerts);
alertsRouter.get("/alerts/:alertId", requireApiKeyReadScope(["alerts:read"]), getAlertById);
alertsRouter.patch("/alerts/:alertId/acknowledge", requireAuth, acknowledgeAlert);
alertsRouter.patch("/alerts/:alertId/resolve", requireAuth, resolveAlert);
