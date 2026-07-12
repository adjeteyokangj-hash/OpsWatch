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
  const checks: Record<string, { status: string; latencyMs?: number; message?: string }> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: "ok", latencyMs: Date.now() - started };
  } catch (error) {
    checks.database = {
      status: "fail",
      message: error instanceof Error ? error.message : "Database unavailable"
    };
    res.status(503).json({
      service: "opswatch-api",
      status: "not_ready",
      timestamp: new Date().toISOString(),
      checks
    });
    return;
  }

  try {
    const sessionCheckStarted = Date.now();
    await prisma.userSession.count({ take: 1 });
    checks.sessions = { status: "ok", latencyMs: Date.now() - sessionCheckStarted };
  } catch (error) {
    checks.sessions = {
      status: "fail",
      message: error instanceof Error ? error.message : "UserSession table unavailable"
    };
    res.status(503).json({
      service: "opswatch-api",
      status: "not_ready",
      timestamp: new Date().toISOString(),
      checks
    });
    return;
  }

  res.json({
    service: "opswatch-api",
    status: "ready",
    timestamp: new Date().toISOString(),
    checks
  });
});
