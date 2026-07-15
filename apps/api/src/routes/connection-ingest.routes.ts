import { Router } from "express";
import { ingestSignedConnectionEvent } from "../controllers/connection-ingest.controller";

export const connectionIngestRouter = Router();

connectionIngestRouter.post("/ingest/connections/:connectionId/events", ingestSignedConnectionEvent);
