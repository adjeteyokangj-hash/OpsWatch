import { Router } from "express";
import { requirePermission } from "../middleware/require-permission";
import {
  approveAutomationRunHandler,
  cancelAutomationRunHandler,
  createAutomationPlan,
  getAutomationRun,
  listAutomationPlaybooks,
  postAutomationTestModeHandler,
  rejectAutomationRunHandler,
  requestAutomationApprovalHandler
} from "../controllers/automation.controller";
import {
  createPlaybookDraftHandler,
  deprecatePlaybookVersionHandler,
  listGovernedPlaybooksHandler,
  reviewPlaybookVersionHandler,
  submitPlaybookVersionHandler
} from "../controllers/playbook-governance.controller";

const router = Router();

router.get("/automation/playbooks", requirePermission("automation:plan:observe"), listAutomationPlaybooks);
router.get("/automation/playbooks/governance", requirePermission("playbooks:view"), listGovernedPlaybooksHandler);
router.post("/automation/playbooks/:playbookKey/versions", requirePermission("playbooks:manage"), createPlaybookDraftHandler);
router.post(
  "/automation/playbooks/:playbookKey/versions/:version/submit",
  requirePermission("playbooks:manage"),
  submitPlaybookVersionHandler
);
router.post(
  "/automation/playbooks/:playbookKey/versions/:version/review",
  requirePermission("playbooks:manage"),
  reviewPlaybookVersionHandler
);
router.post(
  "/automation/playbooks/:playbookKey/versions/:version/deprecate",
  requirePermission("playbooks:manage"),
  deprecatePlaybookVersionHandler
);
router.post("/automation/plan", requirePermission("automation:plan:observe"), createAutomationPlan);
router.post("/automation/incidents/:incidentId/plan", requirePermission("automation:plan:observe"), createAutomationPlan);
router.get("/automation/runs/:runId", requirePermission("automation:plan:observe"), getAutomationRun);
router.post("/automation/runs/:runId/request-approval", requirePermission("automation:plan:observe"), requestAutomationApprovalHandler);
router.post("/automation/runs/:runId/approve", requirePermission("automation:plan:approve"), approveAutomationRunHandler);
router.post("/automation/runs/:runId/reject", requirePermission("automation:plan:approve"), rejectAutomationRunHandler);
router.post("/automation/runs/:runId/cancel", requirePermission("automation:plan:observe"), cancelAutomationRunHandler);
router.post("/automation/test-mode", requirePermission("automation:plan:observe"), postAutomationTestModeHandler);

export default router;
