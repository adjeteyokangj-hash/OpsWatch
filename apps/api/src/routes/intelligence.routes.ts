import { Router } from "express";
import { requirePermission } from "../middleware/require-permission";
import {
  getAiDecisionAuditHandler,
  getAiOperationsStatusHandler,
  getAutomationIntelligenceHistoryHandler,
  getFeatureGatesHandler,
  getIntelligenceSnapshotHandler,
  getOperationsTimelineHandler,
  getPredictionStatusHandler,
  reviewPredictionHandler
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
router.get(
  "/intelligence/operations-status",
  requirePermission("diagnosis:read"),
  getAiOperationsStatusHandler
);
router.post(
  "/intelligence/predictions/:predictionId/review",
  requirePermission("remediation:approve"),
  reviewPredictionHandler
);

export default router;
