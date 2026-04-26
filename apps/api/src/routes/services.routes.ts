import { Router } from "express";
import { createCheckByService, listChecksByService, patchCheck } from "../controllers/checks.controller";
import { listServices, createService, patchService, deleteService } from "../controllers/services.controller";

export const servicesRouter = Router();

servicesRouter.get("/services", listServices);
servicesRouter.post("/services", createService);
servicesRouter.patch("/services/:serviceId", patchService);
servicesRouter.delete("/services/:serviceId", deleteService);
servicesRouter.get("/services/:serviceId/checks", listChecksByService);
servicesRouter.post("/services/:serviceId/checks", createCheckByService);
servicesRouter.patch("/services/:serviceId/checks/:checkId", patchCheck);
