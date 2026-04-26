import { Router } from "express";
import {
  getIncidentById,
  getIncidents,
  patchIncident
} from "../controllers/incidents.controller";
import { requireApiKeyReadScope, requireAuth } from "../middleware/auth";

export const incidentsRouter = Router();

incidentsRouter.get("/incidents", requireApiKeyReadScope(["incidents:read"], "projectId"), getIncidents);
incidentsRouter.get("/incidents/:incidentId", requireApiKeyReadScope(["incidents:read"]), getIncidentById);
incidentsRouter.patch("/incidents/:incidentId", requireAuth, patchIncident);
