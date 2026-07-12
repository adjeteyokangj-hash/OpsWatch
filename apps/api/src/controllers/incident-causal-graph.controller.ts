import { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { loadIncidentCausalGraph } from "../services/incident-causal-graph-loader.service";

const requireOrg = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

export const getIncidentCausalGraph = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;

  const graph = await loadIncidentCausalGraph(orgId, String(req.params.incidentId));
  if (!graph) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }

  res.json(graph);
};
