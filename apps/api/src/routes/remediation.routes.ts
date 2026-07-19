import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/require-permission";
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
import {
  listRemediationActions,
  requestPhase7Approval,
  decidePhase7Approval,
  executePhase7Governed,
  listPhase7Runs,
  tripPhase7Circuit,
  resetPhase7Circuit,
  recoverPhase7StaleRuns
} from "../controllers/phase7-remediation.controller";

const router = Router();

// All remediation endpoints require authentication
router.use(requireAuth);

// Phase 7 governed remediation
router.get("/actions", listRemediationActions);
router.get("/runs", listPhase7Runs);
router.post("/approvals", requirePermission("remediation:execute:safe"), requestPhase7Approval);
router.post(
  "/approvals/:approvalId/decide",
  requirePermission("remediation:approve"),
  decidePhase7Approval
);
router.post("/governed-execute", executePhase7Governed);
router.post("/circuit-breaker/trip", requirePermission("policy:manage"), tripPhase7Circuit);
router.post("/circuit-breaker/reset", requirePermission("policy:manage"), resetPhase7Circuit);
router.post("/runs/recover-stale", requirePermission("policy:manage"), recoverPhase7StaleRuns);

// GET  /remediation/logs               → list org's remediation history
router.get("/logs", getRemediationLogs);

// POST /remediation/suggest            → get AI diagnosis + suggested actions
router.post("/suggest", requirePermission("diagnosis:read"), suggestRemediation);

// POST /remediation/execute            → run a safe action or queue unsafe for approval
router.post("/execute", executeRemediationAction);

// POST /remediation/logs/:logId/approve → approve a pending unsafe action
router.post(
  "/logs/:logId/approve",
  requirePermission("remediation:approve"),
  approveRemediation
);

// GET  /remediation/accuracy           → prediction vs outcome accuracy stats (ADMIN only)
router.get("/accuracy", requireRole("ADMIN"), getRemediationAccuracy);

// GET  /remediation/policy             → list policy settings
router.get("/policy", requirePermission("policy:manage"), getAutoRunPolicy);

// PUT  /remediation/policy             → upsert a policy switch
router.put("/policy", requirePermission("policy:manage"), updateAutoRunPolicy);

// POST /remediation/auto-run           → controlled automatic execution path
router.post("/auto-run", requirePermission("remediation:auto_heal"), triggerAutoRun);

// Compatibility route for incident-scoped auto-run trigger
router.post("/:incidentId/auto-run", requirePermission("remediation:auto_heal"), runIncidentAutoRemediation);

// GET  /remediation/auto-run/metrics   → auto-run volume & success metrics (ADMIN only)
router.get("/auto-run/metrics", requireRole("ADMIN"), getAutoRunMetrics);

// Compatibility route for combined remediation metrics
router.get("/accuracy/metrics", requireRole("ADMIN"), getRemediationAccuracyMetrics);

export default router;
