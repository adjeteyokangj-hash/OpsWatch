import { Router } from "express";
import { requirePermission } from "../middleware/require-permission";
import { getOperationsAnalyticsHandler } from "../controllers/operations-analytics.controller";
import { getLayerHealthRollupHandler } from "../controllers/layer-health.controller";

const router = Router();

router.get("/analytics/layer-health", getLayerHealthRollupHandler);
router.get("/analytics/operations", requirePermission("analytics:view"), getOperationsAnalyticsHandler);

export default router;
