import { Router } from "express";
import { ingestHeartbeatController } from "../controllers/heartbeats.controller";
import { requireApiKeyScopes } from "../middleware/auth";

export const heartbeatsRouter = Router();
heartbeatsRouter.post("/heartbeat", requireApiKeyScopes(["heartbeats:write"]), ingestHeartbeatController);
