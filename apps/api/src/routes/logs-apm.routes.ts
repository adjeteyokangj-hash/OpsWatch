import { Router } from "express";
import {
  getApm,
  getLogById,
  getLogGroups,
  getLogsApmStatus,
  getTrace,
  searchLogs
} from "../controllers/logs-apm.controller";

export const logsApmRouter = Router();

logsApmRouter.get("/projects/:projectId/logs/status", getLogsApmStatus);
logsApmRouter.get("/projects/:projectId/logs", searchLogs);
logsApmRouter.get("/projects/:projectId/logs/groups", getLogGroups);
logsApmRouter.get("/projects/:projectId/logs/:logId", getLogById);
logsApmRouter.get("/projects/:projectId/apm", getApm);
logsApmRouter.get("/projects/:projectId/apm/overview", getApm);
logsApmRouter.get("/projects/:projectId/traces/:traceId", getTrace);
