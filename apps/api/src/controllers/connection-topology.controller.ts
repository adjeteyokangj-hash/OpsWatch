import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { discoverConnectionTopologyById } from "../services/connections/connection-topology-discovery.service";

export const discoverConnectionTopologyHandler = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const organizationId = req.user?.organizationId;
  if (!organizationId) {
    res.status(403).json({ error: "Organization required" });
    return;
  }

  const connectionId = req.params.connectionId;
  if (!connectionId) {
    res.status(400).json({ error: "Connection ID required" });
    return;
  }

  try {
    const result = await discoverConnectionTopologyById(
      organizationId,
      connectionId
    );
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Topology discovery failed";
    const status = /not found/i.test(message) ? 404 : 422;
    res.status(status).json({
      error: message,
      errorCategory: "TOPOLOGY_DISCOVERY_FAILED"
    });
  }
};
