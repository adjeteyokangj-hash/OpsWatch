import { Router } from "express";
import { prisma } from "../lib/prisma";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({
    service: "opswatch-api",
    status: "ok",
    timestamp: new Date().toISOString()
  });
});

healthRouter.get("/health/live", (_req, res) => {
  res.json({
    service: "opswatch-api",
    status: "live",
    timestamp: new Date().toISOString()
  });
});

healthRouter.get("/health/ready", async (_req, res) => {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - started;
    res.json({
      service: "opswatch-api",
      status: "ready",
      timestamp: new Date().toISOString(),
      checks: {
        database: { status: "ok", latencyMs }
      }
    });
  } catch (error) {
    res.status(503).json({
      service: "opswatch-api",
      status: "not_ready",
      timestamp: new Date().toISOString(),
      checks: {
        database: { status: "fail", message: error instanceof Error ? error.message : "Database unavailable" }
      }
    });
  }
});
