import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/require-role";
import {
  suggestRemediation,
  executeRemediationAction,
  getRemediationLogs,
  approveRemediation,
  getRemediationAccuracy,
} from "../controllers/remediation.controller";
import {
  getAutoRunPolicy,
  updateAutoRunPolicy,
  runIncidentAutoRemediation,
  getRemediationAccuracyMetrics,
  triggerAutoRun,
  getAutoRunMetrics,
} from "../controllers/auto-run.controller";

const router = Router();

// All remediation endpoints require authentication
router.use(requireAuth);

// GET  /remediation/logs               → list org's remediation history
router.get("/logs", getRemediationLogs);

// POST /remediation/suggest            → get AI diagnosis + suggested actions
router.post("/suggest", suggestRemediation);

// POST /remediation/execute            → run a safe action or queue unsafe for approval
router.post("/execute", executeRemediationAction);

// POST /remediation/logs/:logId/approve → approve a pending unsafe action (ADMIN only)
router.post("/logs/:logId/approve", requireRole("ADMIN"), approveRemediation);

// GET  /remediation/accuracy           → prediction vs outcome accuracy stats (ADMIN only)
router.get("/accuracy", requireRole("ADMIN"), getRemediationAccuracy);

// GET  /remediation/policy             → list policy settings (ADMIN only)
router.get("/policy", requireRole("ADMIN"), getAutoRunPolicy);

// PUT  /remediation/policy             → upsert a policy switch (ADMIN only)
router.put("/policy", requireRole("ADMIN"), updateAutoRunPolicy);

// POST /remediation/auto-run           → controlled automatic execution path
router.post("/auto-run", triggerAutoRun);

// Compatibility route for incident-scoped auto-run trigger
router.post("/:incidentId/auto-run", runIncidentAutoRemediation);

// GET  /remediation/auto-run/metrics   → auto-run volume & success metrics (ADMIN only)
router.get("/auto-run/metrics", requireRole("ADMIN"), getAutoRunMetrics);

// Compatibility route for combined remediation metrics
router.get("/accuracy/metrics", requireRole("ADMIN"), getRemediationAccuracyMetrics);

export default router;
