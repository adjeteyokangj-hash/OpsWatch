import { createHmac } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "../config/constants";
import { sha256 } from "../utils/crypto";
import { verifyJwt } from "../utils/jwt";

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

const authorizeApiKey = async (req: AuthRequest, requiredScopes: string[]): Promise<boolean> => {
  const headerKey = req.header("x-api-key") || extractBearer(req);
  const parsed = parseMonitorKey(headerKey);
  if (!parsed) return false;

  const row = await prisma.orgApiKey.findFirst({
    where: {
      keyId: parsed.keyId,
      isActive: true,
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

export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!tryAttachJwt(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!tryAttachJwt(req)) {
    res.status(401).json({ error: "Unauthorized" });
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

export const requireIngestSignature = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const projectKey = req.header("x-opswatch-project-key");
  const timestamp = req.header(TIMESTAMP_HEADER);
  const signature = req.header(SIGNATURE_HEADER);

  if (!projectKey || !timestamp || !signature) {
    res.status(401).json({ error: "Missing ingest signature headers" });
    return;
  }

  const project = await prisma.project.findUnique({ where: { apiKey: projectKey } });
  if (!project) {
    res.status(401).json({ error: "Invalid project key" });
    return;
  }

  const body = JSON.stringify(req.body ?? {});
  const payload = `${timestamp}.${body}`;
  const expected = createHmac("sha256", project.signingSecret).update(payload).digest("hex");

  if (signature !== expected) {
    res.status(401).json({ error: "Invalid ingest signature" });
    return;
  }

  next();
};
