import { Router } from "express";
import {
  ingestEventController,
  ingestHealthSnapshotController
} from "../controllers/events.controller";
import { requireApiKeyScopes } from "../middleware/auth";

export const eventsRouter = Router();

eventsRouter.post("/event", requireApiKeyScopes(["events:write"]), ingestEventController);
eventsRouter.post("/health-snapshot", requireApiKeyScopes(["events:write"]), ingestHealthSnapshotController);
