import type { NextFunction, Response } from "express";
import { hasPermission, type Permission } from "../auth/permissions";
import type { AuthRequest } from "./auth";

export const requirePermission = (...permissions: Permission[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const allowed = permissions.some((permission) => hasPermission(req.user?.role, permission));
    if (!allowed) {
      res.status(403).json({ error: "Forbidden", requiredPermissions: permissions });
      return;
    }

    next();
  };
};
