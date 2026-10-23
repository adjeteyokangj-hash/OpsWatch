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
import { getProjectModuleCatalogue, getModuleCatalogue, createCustomModule, updateCustomModule, reviewProjectModule, analyseProjectModules, bindProjectModule } from "../controllers/module-catalogue.controller";
import { getRelationshipIncidentMemorySignals } from "../controllers/topology.controller";
import {
  getProjectAutonomousMode,
  patchProjectAutonomousMode
} from "../controllers/project-automation-mode.controller";
import {
  getProjectBillingHandler,
  updateProjectBillingHandler,
  createProjectCheckoutHandler,
  createProjectPortalHandler,
  listProjectInvoicesHandler,
  listBillingPlansHandler
} from "../controllers/project-billing.controller";
import { patchMonitoredDeviceLabel } from "../controllers/monitored-devices.controller";
import { requireAdmin } from "../middleware/auth";

export const projectsRouter = Router();
projectsRouter.get("/module-catalogue", getModuleCatalogue);
projectsRouter.post("/module-catalogue", createCustomModule);
projectsRouter.put("/module-catalogue/:moduleKey", updateCustomModule);
projectsRouter.post("/projects/:projectId/module-catalogue/analyse", analyseProjectModules);
projectsRouter.put("/projects/:projectId/module-catalogue/:moduleKey", reviewProjectModule);
projectsRouter.put("/projects/:projectId/module-catalogue/:moduleKey/component", bindProjectModule);

projectsRouter.get("/projects", listProjects);
projectsRouter.post("/projects", createProject);
projectsRouter.get("/projects/:projectId", getProjectById);
projectsRouter.patch("/projects/:projectId/devices/:deviceId", patchMonitoredDeviceLabel);
projectsRouter.patch("/projects/:projectId", patchProject);
projectsRouter.delete("/projects/:projectId", requireAdmin, deleteProject);

projectsRouter.get("/projects/:projectId/topology", getProjectTopology);
projectsRouter.get("/projects/:projectId/module-catalogue", getProjectModuleCatalogue);
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
projectsRouter.post("/projects/:projectId/billing/checkout", createProjectCheckoutHandler);
projectsRouter.post("/projects/:projectId/billing/portal", createProjectPortalHandler);
projectsRouter.get("/projects/:projectId/billing/invoices", listProjectInvoicesHandler);
projectsRouter.get("/projects/:projectId/billing/plans", listBillingPlansHandler);
