import { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { loadProjectTopology } from "../services/topology-loader.service";

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
