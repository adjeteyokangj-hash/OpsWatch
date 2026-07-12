import { Router } from "express";
import {
  ingestEventController,
  ingestHealthSnapshotController
} from "../controllers/events.controller";
import { requireApiKeyScopes } from "../middleware/auth";
import { requireIngestReplayProtection } from "../middleware/ingest-replay";

export const eventsRouter = Router();

eventsRouter.post(
  "/event",
  requireApiKeyScopes(["events:write"]),
  requireIngestReplayProtection("event"),
  ingestEventController
);
eventsRouter.post(
  "/health-snapshot",
  requireApiKeyScopes(["events:write"]),
  requireIngestReplayProtection("health-snapshot"),
  ingestHealthSnapshotController
);
