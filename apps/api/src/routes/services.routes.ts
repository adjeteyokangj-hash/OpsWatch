import { Router } from "express";
import { createCheckByService, listChecksByService, patchCheck } from "../controllers/checks.controller";
import {
  listServices,
  createService,
  patchService,
  deleteService,
  getServiceOwnershipHandler,
  patchServiceOwnershipHandler
} from "../controllers/services.controller";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/require-permission";

export const servicesRouter = Router();

servicesRouter.get("/services", listServices);
servicesRouter.post("/services", createService);
servicesRouter.patch("/services/:serviceId", patchService);
servicesRouter.delete("/services/:serviceId", deleteService);
servicesRouter.get("/services/:serviceId/ownership", requireAuth, getServiceOwnershipHandler);
servicesRouter.patch(
  "/services/:serviceId/ownership",
  requireAuth,
  requirePermission("policy:manage"),
  patchServiceOwnershipHandler
);
servicesRouter.get("/services/:serviceId/checks", listChecksByService);
servicesRouter.post("/services/:serviceId/checks", createCheckByService);
servicesRouter.patch("/services/:serviceId/checks/:checkId", patchCheck);
