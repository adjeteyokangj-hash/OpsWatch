import { Router } from "express";
import {
  acceptRiskController,
  externalSurfaceCheckController,
  getSecurityCoverageController,
  getSecurityFindingController,
  getSequenceController,
  getTopologyOverlayController,
  ingestSecurityEventsController,
  listRulesController,
  listSecurityFindingsController,
  listSequencesController,
  markFalsePositiveController,
  securityResponseController,
  suppressFindingController,
  updateRuleController
} from "../controllers/security.controller";
import { requireAnyApiKeyScopes, requireAuth } from "../middleware/auth";
import { requireIngestReplayProtection } from "../middleware/ingest-replay";
import { SECURITY_WRITE_SCOPES } from "../services/security/security-scopes";

export const securityRouter = Router();

securityRouter.post(
  "/security/events",
  requireAnyApiKeyScopes([...SECURITY_WRITE_SCOPES]),
  requireIngestReplayProtection("security-events"),
  ingestSecurityEventsController
);

securityRouter.post(
  "/security/events/batch",
  requireAnyApiKeyScopes([...SECURITY_WRITE_SCOPES]),
  requireIngestReplayProtection("security-events-batch"),
  ingestSecurityEventsController
);

securityRouter.get("/security/findings", requireAuth, listSecurityFindingsController);
securityRouter.get("/security/findings/:id", requireAuth, getSecurityFindingController);
securityRouter.post("/security/findings/:id/false-positive", requireAuth, markFalsePositiveController);
securityRouter.post("/security/findings/:id/accepted-risk", requireAuth, acceptRiskController);
securityRouter.post("/security/findings/:id/suppress", requireAuth, suppressFindingController);
securityRouter.get("/security/coverage", requireAuth, getSecurityCoverageController);
securityRouter.get("/security/sequences", requireAuth, listSequencesController);
securityRouter.get("/security/sequences/:id", requireAuth, getSequenceController);
securityRouter.get("/security/topology-overlay", requireAuth, getTopologyOverlayController);
securityRouter.get("/security/rules", requireAuth, listRulesController);
securityRouter.patch("/security/rules/:id", requireAuth, updateRuleController);
securityRouter.post("/security/response", requireAuth, securityResponseController);
securityRouter.post("/security/external-check", requireAuth, externalSurfaceCheckController);
