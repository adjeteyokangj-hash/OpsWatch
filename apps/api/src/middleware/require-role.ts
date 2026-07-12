import type { NextFunction, Response } from "express";
import { normalizeRole, type OpsWatchRole } from "../auth/permissions";
import type { AuthRequest } from "./auth";

const roleRank: Record<OpsWatchRole, number> = {
  VIEWER: 0,
  INCIDENT_RESPONDER: 1,
  AUTOMATION_OPERATOR: 2,
  ADMIN: 3
};

export const requireRole = (minimumRole: OpsWatchRole | "ADMIN" | "MEMBER") => {
  const required =
    minimumRole === "MEMBER" ? ("INCIDENT_RESPONDER" as OpsWatchRole) : (minimumRole as OpsWatchRole);

  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (roleRank[normalizeRole(req.user.role)] < roleRank[required]) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
};

