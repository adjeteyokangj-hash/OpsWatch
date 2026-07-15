import { Router } from "express";
import { requirePermission } from "../middleware/require-permission";
import {
  getAiDecisionAuditHandler,
  getAutomationIntelligenceHistoryHandler,
  getFeatureGatesHandler,
  getIntelligenceSnapshotHandler,
  getOperationsTimelineHandler,
  getPredictionStatusHandler
} from "../controllers/intelligence.controller";

const router = Router();

router.get(
  "/intelligence",
  requirePermission("diagnosis:read"),
  getIntelligenceSnapshotHandler
);
router.get(
  "/intelligence/timeline",
  requirePermission("incidents:read"),
  getOperationsTimelineHandler
);
router.get(
  "/intelligence/automation-history",
  requirePermission("automation:plan:observe"),
  getAutomationIntelligenceHistoryHandler
);
router.get(
  "/intelligence/audit",
  requirePermission("analytics:view"),
  getAiDecisionAuditHandler
);
router.get(
  "/intelligence/predictions/status",
  requirePermission("diagnosis:read"),
  getPredictionStatusHandler
);
router.get(
  "/intelligence/feature-gates",
  requirePermission("diagnosis:read"),
  getFeatureGatesHandler
);

export default router;
