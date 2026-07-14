import type { AuthRequest } from "./auth";
import type { NextFunction, Response } from "express";

/** Built-in platform operators (always allowlisted; env / DB can add more). */
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

export const isPlatformSuperAdminEmail = (userEmail?: string | null): boolean => {
  if (!userEmail) return false;
  return platformSuperAdminEmails().includes(userEmail.trim().toLowerCase());
};

/** Prefer DB flag when present; always honor env/hardcoded email allowlist. */
export const isPlatformSuperAdmin = (
  userEmail?: string | null,
  dbFlag?: boolean | null
): boolean => {
  if (dbFlag) return true;
  return isPlatformSuperAdminEmail(userEmail);
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
  const dbFlag =
    typeof req.user.isPlatformSuperAdmin === "boolean" ? req.user.isPlatformSuperAdmin : null;
  if (!isPlatformSuperAdmin(req.user.email, dbFlag)) {
    res.status(403).json({ error: "Platform super admin access required" });
    return;
  }
  next();
};
