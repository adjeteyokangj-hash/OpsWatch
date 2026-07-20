import { Router } from "express";
import {
  getSecurityCoverageController,
  ingestSecurityEventsController,
  listSecurityFindingsController
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
securityRouter.get("/security/coverage", requireAuth, getSecurityCoverageController);
