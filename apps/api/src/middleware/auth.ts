import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { CSRF_HEADER } from "../config/session";
import { isSessionAuthEnabled } from "../config/session";
import { readCsrfToken, readSessionToken } from "../lib/session-cookie";
import { sha256 } from "../utils/crypto";
import { verifyJwt } from "../utils/jwt";
import { verifySessionCsrf, validateSessionToken } from "../services/session.service";

export interface AuthRequest extends Request {
  user?: {
    sub?: string;
    id?: string;
    email?: string;
    role?: string;
    organizationId?: string;
    [key: string]: unknown;
  };
  apiKeyId?: string;
  apiKeyScopes?: string[];
  apiKeyOrganizationId?: string;
  apiKeyProjectId?: string | null;
  sessionId?: string;
  sessionAuth?: boolean;
  sessionCsrfTokenHash?: string;
}

const extractBearer = (req: Request): string | null => {
  const authHeader = req.header("authorization");
  if (!authHeader) return null;
  const [scheme, value] = authHeader.split(" ");
  if (!scheme || !value || scheme.toLowerCase() !== "bearer") return null;
  return value.trim();
};

const parseMonitorKey = (value: string | null): { keyId: string; secret: string } | null => {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [keyId, secret] = parts;
  if (!keyId || !secret) return null;
  return { keyId, secret };
};

const tryAttachJwt = (req: AuthRequest): boolean => {
  const bearer = extractBearer(req);
  if (!bearer) return false;
  try {
    const decoded = verifyJwt(bearer);
    req.user = {
      sub: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      organizationId: decoded.organizationId
    };
    return true;
  } catch {
    return false;
  }
};

const tryAttachSession = async (req: AuthRequest): Promise<boolean> => {
  if (!isSessionAuthEnabled()) {
    return false;
  }

  const sessionToken = readSessionToken(req.headers.cookie);
  if (!sessionToken) {
    return false;
  }

  const validated = await validateSessionToken(sessionToken);
  if (!validated) {
    return false;
  }

  req.sessionId = validated.sessionId;
  req.sessionAuth = true;
  req.sessionCsrfTokenHash = validated.csrfTokenHash;
  req.user = {
    sub: validated.user.id,
    id: validated.user.id,
    email: validated.user.email,
    role: validated.user.role,
    organizationId: validated.user.organizationId ?? undefined
  };
  return true;
};

const validateSessionCsrfRequest = (req: AuthRequest): boolean => {
  if (!req.sessionAuth || !req.sessionId) {
    return true;
  }

  if (["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) {
    return true;
  }

  const cookieToken = readCsrfToken(req.headers.cookie);
  const headerToken = req.header(CSRF_HEADER)?.trim();
  if (!cookieToken || !headerToken) {
    return false;
  }

  if (cookieToken !== headerToken) {
    return false;
  }

  if (req.sessionCsrfTokenHash && !verifySessionCsrf(headerToken, req.sessionCsrfTokenHash)) {
    return false;
  }

  return true;
};

const authorizeApiKey = async (req: AuthRequest, requiredScopes: string[]): Promise<boolean> => {
  const headerKey = req.header("x-api-key") || extractBearer(req);
  const parsed = parseMonitorKey(headerKey);
  if (!parsed) return false;

  const row = await prisma.orgApiKey.findFirst({
    where: {
      keyId: parsed.keyId,
      revokedAt: null
    }
  });

  if (!row || !row.secretHash || row.secretHash !== sha256(parsed.secret)) {
    return false;
  }

  const scopes = Array.isArray(row.scopes) ? (row.scopes as string[]) : [];
  const allowed = requiredScopes.every((scope) => scopes.includes(scope));
  if (!allowed) return false;

  req.apiKeyId = row.id;
  req.apiKeyScopes = scopes;
  req.apiKeyOrganizationId = row.organizationId;
  req.apiKeyProjectId = row.projectId ?? null;
  return true;
};

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  if ((await tryAttachSession(req)) || tryAttachJwt(req)) {
    if (!validateSessionCsrfRequest(req)) {
      res.status(403).json({ error: "Invalid CSRF token", code: "CSRF_INVALID" });
      return;
    }
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
};

export const requireAdmin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!(await tryAttachSession(req)) && !tryAttachJwt(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!validateSessionCsrfRequest(req)) {
    res.status(403).json({ error: "Invalid CSRF token", code: "CSRF_INVALID" });
    return;
  }

  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  next();
};

export const requireApiKeyScopes = (requiredScopes: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (await authorizeApiKey(req, requiredScopes)) {
      next();
      return;
    }
    res.status(401).json({ error: "Invalid or insufficient API key" });
  };
};

export const requireApiKeyReadScope = (requiredScopes: string[], _projectIdParam?: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (tryAttachJwt(req)) {
      next();
      return;
    }

    if (await authorizeApiKey(req, requiredScopes)) {
      next();
      return;
    }

    res.status(401).json({ error: "Unauthorized" });
  };
};

export { tryAttachSession, validateSessionCsrfRequest };
