import { Router } from "express";
import {
  createProject,
  deleteProject,
  getProjectById,
  listProjects,
  patchProject
} from "../controllers/projects.controller";
import {
  createServiceByProject,
  listServicesByProject
} from "../controllers/services.controller";
import { listProjectCheckResults } from "../controllers/checks.controller";
import {
  createServiceDependencyByProject,
  deleteServiceDependencyByProject,
  listServiceDependenciesByProject,
  patchServiceDependencyByProject
} from "../controllers/service-dependencies.controller";
import {
  createSloDefinitionByProject,
  deleteSloDefinitionByProject,
  listSloDefinitionsByProject,
  listSloWindowsByProject,
  patchSloDefinitionByProject
} from "../controllers/slos.controller";
import { getProjectTopology } from "../controllers/topology.controller";
import { getRelationshipIncidentMemorySignals } from "../controllers/topology.controller";
import {
  getProjectAutonomousMode,
  patchProjectAutonomousMode
} from "../controllers/project-automation-mode.controller";
import {
  getProjectBillingHandler,
  updateProjectBillingHandler
} from "../controllers/project-billing.controller";
import { requireAdmin } from "../middleware/auth";

export const projectsRouter = Router();

projectsRouter.get("/projects", listProjects);
projectsRouter.post("/projects", createProject);
projectsRouter.get("/projects/:projectId", getProjectById);
projectsRouter.patch("/projects/:projectId", patchProject);
projectsRouter.delete("/projects/:projectId", requireAdmin, deleteProject);

projectsRouter.get("/projects/:projectId/topology", getProjectTopology);
projectsRouter.get(
  "/projects/:projectId/topology/relationships/:edgeId/incident-memory",
  getRelationshipIncidentMemorySignals
);

projectsRouter.get("/projects/:projectId/automation-mode", getProjectAutonomousMode);
projectsRouter.patch("/projects/:projectId/automation-mode", patchProjectAutonomousMode);

projectsRouter.get("/projects/:projectId/services", listServicesByProject);
projectsRouter.post("/projects/:projectId/services", createServiceByProject);

projectsRouter.get("/projects/:projectId/checks/results", listProjectCheckResults);

projectsRouter.get("/projects/:projectId/service-dependencies", listServiceDependenciesByProject);
projectsRouter.post("/projects/:projectId/service-dependencies", createServiceDependencyByProject);
projectsRouter.patch("/projects/:projectId/service-dependencies/:dependencyId", patchServiceDependencyByProject);
projectsRouter.delete("/projects/:projectId/service-dependencies/:dependencyId", deleteServiceDependencyByProject);

projectsRouter.get("/projects/:projectId/slos", listSloDefinitionsByProject);
projectsRouter.post("/projects/:projectId/slos", createSloDefinitionByProject);
projectsRouter.patch("/projects/:projectId/slos/:sloId", patchSloDefinitionByProject);
projectsRouter.delete("/projects/:projectId/slos/:sloId", deleteSloDefinitionByProject);
projectsRouter.get("/projects/:projectId/slo-windows", listSloWindowsByProject);
projectsRouter.get("/projects/:projectId/billing", getProjectBillingHandler);
projectsRouter.patch("/projects/:projectId/billing", updateProjectBillingHandler);
