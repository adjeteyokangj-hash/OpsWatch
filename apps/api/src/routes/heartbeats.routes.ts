import { Router } from "express";
import { ingestHeartbeatController } from "../controllers/heartbeats.controller";
import { requireApiKeyScopes } from "../middleware/auth";
import { requireIngestReplayProtection } from "../middleware/ingest-replay";

export const heartbeatsRouter = Router();
heartbeatsRouter.post(
  "/heartbeat",
  requireApiKeyScopes(["heartbeats:write"]),
  requireIngestReplayProtection("heartbeat"),
  ingestHeartbeatController
);
