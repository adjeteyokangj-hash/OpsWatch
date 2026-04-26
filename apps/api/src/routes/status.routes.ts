import { Router } from "express";
import { getPublicStatus } from "../controllers/status.controller";

export const statusRouter = Router();
statusRouter.get("/status/public", getPublicStatus);
