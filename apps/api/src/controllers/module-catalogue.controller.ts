import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { CORE_MODULE_CATALOGUE, proposeProjectModules } from "../services/topology/module-catalogue.service";

/** Read-only discovery. A proposal is not a service, health check, or approved assignment. */
export const getProjectModuleCatalogue = async (req: AuthRequest, res: Response): Promise<void> => {
  const organizationId = req.user?.organizationId;
  if (!organizationId) {
    res.status(403).json({ error: "Organization required" });
    return;
  }
  const projectId = String(req.params.projectId);
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true, name: true }
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  // Project name is descriptive evidence, never proof of a deployed module.
  const proposals = proposeProjectModules({ description: project.name });
  res.json({
    projectId: project.id,
    catalogue: CORE_MODULE_CATALOGUE.map(({ key, label }) => ({ key, label })),
    proposals,
    discovery: {
      state: "PARTIAL",
      sources: ["project_name"],
      missingSources: ["project_description", "public_url_inspection", "authorised_connected_api_capabilities"],
      note: "Read-only preliminary suggestions. No live topology or monitoring is created."
    }
  });
};
