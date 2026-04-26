import { Router } from "express";
import { getCheckById, listCheckResults, listChecks } from "../controllers/checks.controller";

export const checksRouter = Router();
checksRouter.get("/checks", listChecks);
checksRouter.get("/checks/results", listCheckResults);
checksRouter.get("/checks/:checkId", getCheckById);
