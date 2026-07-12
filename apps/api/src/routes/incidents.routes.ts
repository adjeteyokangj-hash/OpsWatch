import { Router } from "express";
import {
  createChangeEvent,
  getIncidentById,
  getIncidents,
  getIncidentRootCauseCandidates,
  getIncidentTimeline,
  listChangeEvents,
  patchIncident
} from "../controllers/incidents.controller";
import { getIncidentCausalGraph } from "../controllers/incident-causal-graph.controller";
import { requireApiKeyReadScope, requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/require-permission";

export const incidentsRouter = Router();

incidentsRouter.get("/incidents", requireApiKeyReadScope(["incidents:read"], "projectId"), getIncidents);
incidentsRouter.get("/incidents/:incidentId", requireApiKeyReadScope(["incidents:read"]), getIncidentById);
incidentsRouter.get("/incidents/:incidentId/timeline", requireApiKeyReadScope(["incidents:read"]), getIncidentTimeline);
incidentsRouter.get("/incidents/:incidentId/root-cause-candidates", requireApiKeyReadScope(["incidents:read"]), getIncidentRootCauseCandidates);
incidentsRouter.get("/incidents/:incidentId/causal-graph", requireApiKeyReadScope(["incidents:read"]), getIncidentCausalGraph);
incidentsRouter.patch("/incidents/:incidentId", requireAuth, patchIncident);

incidentsRouter.get("/projects/:projectId/change-events", requireApiKeyReadScope(["incidents:read"], "projectId"), listChangeEvents);
incidentsRouter.post("/projects/:projectId/change-events", requireAuth, requirePermission("remediation:execute:safe"), createChangeEvent);
