import { Router } from "express";
import { ingestSignedConnectionEvent } from "../controllers/connection-ingest.controller";
import { ingestOtelBridge } from "../controllers/otel-bridge.controller";

export const connectionIngestRouter = Router();

connectionIngestRouter.post("/ingest/connections/:connectionId/events", ingestSignedConnectionEvent);
connectionIngestRouter.post("/internal/otel/v1/bridge/connections/:connectionId", ingestOtelBridge);
