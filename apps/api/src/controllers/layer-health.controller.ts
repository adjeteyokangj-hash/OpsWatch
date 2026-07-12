import { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { buildLayerHealthRollup } from "../services/layer-health-rollup.service";

export const getLayerHealthRollupHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return;
  }
  res.json(await buildLayerHealthRollup(orgId));
};
