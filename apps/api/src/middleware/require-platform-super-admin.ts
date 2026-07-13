import type { NextFunction, Response } from "express";
import type { AuthRequest } from "./auth";

/** Built-in platform operators (always allowlisted; env can add more). */
const DEFAULT_PLATFORM_SUPER_ADMIN_EMAILS = ["admin@okanggroup.com"] as const;

const normalizeEmails = (raw: string | undefined): string[] =>
  raw
    ?.split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean) ?? [];

export const platformSuperAdminEmails = (): string[] => {
  const fromEnv = normalizeEmails(process.env.PLATFORM_SUPER_ADMIN_EMAILS);
  return Array.from(new Set([...DEFAULT_PLATFORM_SUPER_ADMIN_EMAILS, ...fromEnv]));
};

export const isPlatformSuperAdmin = (userEmail?: string | null): boolean => {
  if (!userEmail) return false;
  return platformSuperAdminEmails().includes(userEmail.trim().toLowerCase());
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
