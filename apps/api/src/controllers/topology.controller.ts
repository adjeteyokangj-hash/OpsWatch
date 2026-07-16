import { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { loadProjectTopology } from "../services/topology-loader.service";
import { getRelationshipIncidentMemorySignals as fetchRelationshipIncidentMemorySignals } from "../services/ai/relationship-incident-memory.service";

const requireOrg = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

export const getProjectTopology = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;

  const topology = await loadProjectTopology(orgId, String(req.params.projectId));
  if (!topology) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json(topology);
};

export const getRelationshipIncidentMemorySignals = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;

  const projectId = String(req.params.projectId);
  const edgeId = String(req.params.edgeId);

  const signals = await fetchRelationshipIncidentMemorySignals({
    organizationId: orgId,
    projectId,
    edgeId
  });

  res.json(signals);
};
