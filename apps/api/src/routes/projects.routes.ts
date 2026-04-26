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
import { requireAdmin } from "../middleware/auth";

export const projectsRouter = Router();

projectsRouter.get("/projects", listProjects);
projectsRouter.post("/projects", createProject);
projectsRouter.get("/projects/:projectId", getProjectById);
projectsRouter.patch("/projects/:projectId", patchProject);
projectsRouter.delete("/projects/:projectId", requireAdmin, deleteProject);

projectsRouter.get("/projects/:projectId/services", listServicesByProject);
projectsRouter.post("/projects/:projectId/services", createServiceByProject);

projectsRouter.get("/projects/:projectId/checks/results", listProjectCheckResults);
