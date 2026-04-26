import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({
    service: "opswatch-api",
    status: "ok",
    timestamp: new Date().toISOString()
  });
});
