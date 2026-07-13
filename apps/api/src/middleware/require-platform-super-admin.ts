import type { NextFunction, Response } from "express";
import type { AuthRequest } from "./auth";

export const platformSuperAdminEmails = (): string[] =>
  process.env.PLATFORM_SUPER_ADMIN_EMAILS?.split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean) ?? [];

export const isPlatformSuperAdmin = (userEmail?: string | null): boolean => {
  const allowlist = platformSuperAdminEmails();
  if (allowlist.length === 0) return false;
  if (!userEmail) return false;
  return allowlist.includes(userEmail.trim().toLowerCase());
};

export const requirePlatformSuperAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!isPlatformSuperAdmin(req.user.email)) {
    res.status(403).json({ error: "Platform super admin access required" });
    return;
  }
  next();
};
