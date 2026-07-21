import { timingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { CSRF_HEADER } from "../config/session";
import { isSessionAuthEnabled } from "../config/session";
import { readCsrfToken, readSessionToken } from "../lib/session-cookie";
import { sha256 } from "../utils/crypto";
import { verifyJwt } from "../utils/jwt";
import { verifySessionCsrf, validateSessionToken } from "../services/session.service";
import { recordCredentialAudit } from "../services/credentials/credential-audit.service";

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
  apiKeyEnvironment?: string;
  sessionId?: string;
  sessionAuth?: boolean;
  sessionCsrfTokenHash?: string;
}

export type ApiKeyAuthFailureReason =
  | "invalid"
  | "expired"
  | "revoked"
  | "rate_limited"
  | "insufficient_scope"
  | "environment_mismatch";

export type ApiKeyAuthResult =
  | { ok: true; reason?: undefined }
  | { ok: false; reason: ApiKeyAuthFailureReason };

/**
 * Read the failure reason without relying on control-flow narrowing of the
 * discriminated union. `reason` is present on both members (optional on the
 * success variant), so this compiles cleanly regardless of how a given
 * TypeScript build narrows `result` after an `ok` check. At runtime a failure
 * result always carries a reason, so the fallback is never taken.
 */
const failureReasonOf = (result: ApiKeyAuthResult): ApiKeyAuthFailureReason =>
  result.reason ?? "invalid";

export const ENVIRONMENT_HEADER = "x-opswatch-environment";

const API_KEY_RATE_LIMIT_WINDOW_MS = 60_000;
const API_KEY_RATE_LIMIT_DEFAULT = 120;

const apiKeyRateLimitMap = new Map<string, { count: number; resetAt: number }>();

export const resetApiKeyRateLimitBucketsForTests = (): void => {
  apiKeyRateLimitMap.clear();
};

export const mapProjectEnvironmentToKeyEnvironment = (projectEnvironment: string): "live" | "test" => {
  const normalized = projectEnvironment.trim().toLowerCase();
  if (["development", "staging", "testing", "test"].includes(normalized)) {
    return "test";
  }
  return "live";
};

export const environmentsMatch = (keyEnvironment: string, otherEnvironment: string): boolean =>
  keyEnvironment === mapProjectEnvironmentToKeyEnvironment(otherEnvironment);

const apiKeyRateLimitMax = (): number => {
  const configured = Number(process.env.OPSWATCH_API_KEY_RATE_LIMIT_PER_MINUTE);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return API_KEY_RATE_LIMIT_DEFAULT;
};

const checkApiKeyRateLimit = (apiKeyId: string): boolean => {
  const now = Date.now();
  const maxPerWindow = apiKeyRateLimitMax();
  const bucket = apiKeyRateLimitMap.get(apiKeyId);
  if (!bucket || now >= bucket.resetAt) {
    apiKeyRateLimitMap.set(apiKeyId, { count: 1, resetAt: now + API_KEY_RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= maxPerWindow) {
    return false;
  }
  bucket.count += 1;
  return true;
};

const timingSafeHashEqual = (providedSecret: string, storedHash: string | null | undefined): boolean => {
  if (!storedHash) return false;
  const computed = sha256(providedSecret);
  const computedBuf = Buffer.from(computed, "hex");
  const storedBuf = Buffer.from(storedHash, "hex");
  if (computedBuf.length !== storedBuf.length) {
    return false;
  }
  return timingSafeEqual(computedBuf, storedBuf);
};

const resolveRequestKeyEnvironment = (req: AuthRequest): "live" | "test" | null => {
  const header = req.header(ENVIRONMENT_HEADER)?.trim().toLowerCase();
  if (!header) return null;
  if (header === "live" || header === "test") {
    return header;
  }
  return mapProjectEnvironmentToKeyEnvironment(header);
};

const auditApiKeyFailure = async (
  req: AuthRequest,
  row: { id: string; organizationId: string } | null,
  reason: ApiKeyAuthFailureReason
): Promise<void> => {
  if (!row) return;
  try {
    await recordCredentialAudit({
      organizationId: row.organizationId,
      action: "AUTH_FAILED",
      entityType: "OrgApiKey",
      entityId: row.id,
      metadata: {
        reason,
        route: req.originalUrl || req.path,
        ip: req.ip,
        userAgent: req.header("user-agent") ?? null
      }
    });
  } catch {
    // Audit must not block auth decisions.
  }
};

const auditApiKeySuccess = async (req: AuthRequest, row: { id: string; organizationId: string }): Promise<void> => {
  try {
    await recordCredentialAudit({
      organizationId: row.organizationId,
      action: "CREDENTIAL_USED",
      entityType: "OrgApiKey",
      entityId: row.id,
      metadata: {
        route: req.originalUrl || req.path,
        ip: req.ip,
        userAgent: req.header("user-agent") ?? null
      }
    });
  } catch {
    // Audit must not block auth decisions.
  }
};

const finalizeGraceExpiredKey = (keyId: string): void => {
  void prisma.orgApiKey
    .updateMany({
      where: { id: keyId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "rotated" }
    })
    .catch(() => undefined);
};

const failureMessage = (reason: ApiKeyAuthFailureReason): string => {
  switch (reason) {
    case "invalid":
      return "Invalid API key";
    case "expired":
      return "API key expired";
    case "revoked":
      return "API key revoked";
    case "rate_limited":
      return "API key rate limit exceeded";
    case "insufficient_scope":
      return "Insufficient API key scope";
    case "environment_mismatch":
      return "API key environment mismatch";
  }
};

const failureStatus = (reason: ApiKeyAuthFailureReason): number => {
  if (reason === "rate_limited") return 429;
  if (reason === "insufficient_scope") return 403;
  return 401;
};

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
    organizationId: validated.user.organizationId ?? undefined,
    isPlatformSuperAdmin: validated.user.isPlatformSuperAdmin
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

type OrgApiKeyAuthRow = {
  id: string;
  organizationId: string;
  secretHash: string;
  scopes: unknown;
  environment: string;
  projectId: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  graceExpiresAt: Date | null;
  allowCrossEnvironment: boolean;
};

export const authorizeApiKey = async (
  req: AuthRequest,
  requiredScopes: string[]
): Promise<ApiKeyAuthResult> => {
  const headerKey = req.header("x-api-key") || extractBearer(req);
  const parsed = parseMonitorKey(headerKey);
  if (!parsed) {
    return { ok: false, reason: "invalid" };
  }

  const row = (await prisma.orgApiKey.findFirst({
    where: { keyId: parsed.keyId }
  })) as OrgApiKeyAuthRow | null;

  if (!row) {
    return { ok: false, reason: "invalid" };
  }

  const now = new Date();

  if (row.revokedAt) {
    await auditApiKeyFailure(req, row, "revoked");
    return { ok: false, reason: "revoked" };
  }

  if (row.graceExpiresAt && row.graceExpiresAt <= now) {
    finalizeGraceExpiredKey(row.id);
    await auditApiKeyFailure(req, row, "revoked");
    return { ok: false, reason: "revoked" };
  }

  if (row.expiresAt && row.expiresAt <= now) {
    await auditApiKeyFailure(req, row, "expired");
    return { ok: false, reason: "expired" };
  }

  if (!timingSafeHashEqual(parsed.secret, row.secretHash)) {
    await auditApiKeyFailure(req, row, "invalid");
    return { ok: false, reason: "invalid" };
  }

  const requestEnvironment = resolveRequestKeyEnvironment(req);
  if (
    requestEnvironment &&
    row.environment !== requestEnvironment &&
    !row.allowCrossEnvironment
  ) {
    await auditApiKeyFailure(req, row, "environment_mismatch");
    return { ok: false, reason: "environment_mismatch" };
  }

  const scopes = Array.isArray(row.scopes) ? (row.scopes as string[]) : [];
  const allowed = requiredScopes.every((scope) => scopes.includes(scope));
  if (!allowed) {
    await auditApiKeyFailure(req, row, "insufficient_scope");
    return { ok: false, reason: "insufficient_scope" };
  }

  if (!checkApiKeyRateLimit(row.id)) {
    await auditApiKeyFailure(req, row, "rate_limited");
    return { ok: false, reason: "rate_limited" };
  }

  req.apiKeyId = row.id;
  req.apiKeyScopes = scopes;
  req.apiKeyOrganizationId = row.organizationId;
  req.apiKeyProjectId = row.projectId ?? null;
  req.apiKeyEnvironment = row.environment;

  const route = req.originalUrl || req.path;
  const ip = req.ip ?? null;
  const userAgent = req.header("user-agent") ?? null;
  void prisma.orgApiKey
    .update({
      where: { id: row.id },
      data: {
        lastUsedAt: now,
        lastUsedRoute: route,
        lastUsedIp: ip,
        lastUsedUserAgent: userAgent
      }
    })
    .catch(() => undefined);

  void auditApiKeySuccess(req, row);

  return { ok: true };
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
    const result = await authorizeApiKey(req, requiredScopes);
    if (result.ok) {
      next();
      return;
    }
    const reason = failureReasonOf(result);
    res.status(failureStatus(reason)).json({
      error: failureMessage(reason),
      code: reason.toUpperCase()
    });
  };
};

/** Accept if the key holds at least one of the listed scopes. */
export const requireAnyApiKeyScopes = (acceptedScopes: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    // Authenticate the key without requiring every accepted scope.
    const result = await authorizeApiKey(req, []);
    if (!result.ok) {
      const reason = failureReasonOf(result);
      res.status(failureStatus(reason)).json({
        error: failureMessage(reason),
        code: reason.toUpperCase()
      });
      return;
    }
    const scopes = req.apiKeyScopes || [];
    const allowed = acceptedScopes.some((scope) => scopes.includes(scope));
    if (!allowed) {
      res.status(403).json({
        error: failureMessage("insufficient_scope"),
        code: "INSUFFICIENT_SCOPE"
      });
      return;
    }
    next();
  };
};

export const requireApiKeyReadScope = (requiredScopes: string[], _projectIdParam?: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if ((await tryAttachSession(req)) || tryAttachJwt(req)) {
      if (!validateSessionCsrfRequest(req)) {
        res.status(403).json({ error: "Invalid CSRF token", code: "CSRF_INVALID" });
        return;
      }
      next();
      return;
    }

    const result = await authorizeApiKey(req, requiredScopes);
    if (result.ok) {
      next();
      return;
    }

    const reason = failureReasonOf(result);
    res.status(failureStatus(reason)).json({
      error: failureMessage(reason),
      code: reason.toUpperCase()
    });
  };
};

export { tryAttachSession, validateSessionCsrfRequest };
