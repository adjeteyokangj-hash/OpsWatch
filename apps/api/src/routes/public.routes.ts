import { Router } from "express";
import { publicContactController } from "../controllers/public-contact.controller";

export const publicRouter = Router();

publicRouter.post("/public/contact", publicContactController);
