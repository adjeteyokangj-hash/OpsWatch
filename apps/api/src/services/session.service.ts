import { randomBytes, randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { sessionAbsoluteTtlSeconds, sessionIdleTtlSeconds, sessionIdleTouchIntervalSeconds } from "../config/session";
import { sha256 } from "../utils/crypto";
import { timingSafeEqualString } from "../lib/request-signature";
import { isPlatformSuperAdmin } from "../middleware/require-platform-super-admin";

export type SessionUser = {
  id: string;
  email: string;
  role: string;
  organizationId: string | null;
  name: string;
  isPlatformSuperAdmin: boolean;
};

export type CreatedSession = {
  sessionId: string;
  sessionToken: string;
  csrfToken: string;
};

export type ValidatedSession = {
  sessionId: string;
  user: SessionUser;
  csrfTokenHash: string;
};

const createToken = (): string => randomBytes(32).toString("base64url");

const now = (): Date => new Date();

export const createUserSession = async (input: {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<CreatedSession> => {
  const sessionId = randomUUID();
  const sessionToken = createToken();
  const csrfToken = createToken();
  const createdAt = now();
  const expiresAt = new Date(createdAt.getTime() + sessionAbsoluteTtlSeconds() * 1000);
  const idleExpiresAt = new Date(createdAt.getTime() + sessionIdleTtlSeconds() * 1000);

  await prisma.userSession.create({
    data: {
      id: sessionId,
      userId: input.userId,
      tokenHash: sha256(sessionToken),
      csrfTokenHash: sha256(csrfToken),
      createdAt,
      lastSeenAt: createdAt,
      expiresAt,
      idleExpiresAt,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    }
  });

  return { sessionId, sessionToken, csrfToken };
};

export const validateSessionToken = async (sessionToken: string): Promise<ValidatedSession | null> => {
  const row = await prisma.userSession.findUnique({
    where: { tokenHash: sha256(sessionToken) },
    include: {
      User: {
        select: {
          id: true,
          email: true,
          role: true,
          organizationId: true,
          name: true,
          isActive: true,
          isPlatformSuperAdmin: true
        }
      }
    }
  });

  if (!row || row.revokedAt || !row.User.isActive) {
    return null;
  }

  const current = now();
  if (row.expiresAt <= current || row.idleExpiresAt <= current) {
    return null;
  }

  const touchIntervalMs = sessionIdleTouchIntervalSeconds() * 1000;
  const shouldTouch = current.getTime() - row.lastSeenAt.getTime() >= touchIntervalMs;
  if (shouldTouch) {
    const nextIdleExpiresAt = new Date(current.getTime() + sessionIdleTtlSeconds() * 1000);
    await prisma.userSession.update({
      where: { id: row.id },
      data: {
        lastSeenAt: current,
        idleExpiresAt: nextIdleExpiresAt
      }
    });
  }

  return {
    sessionId: row.id,
    csrfTokenHash: row.csrfTokenHash,
    user: {
      id: row.User.id,
      email: row.User.email,
      role: row.User.role,
      organizationId: row.User.organizationId,
      name: row.User.name,
      isPlatformSuperAdmin: isPlatformSuperAdmin(row.User.email, row.User.isPlatformSuperAdmin)
    }
  };
};

export const verifySessionCsrf = (csrfToken: string, csrfTokenHash: string): boolean =>
  timingSafeEqualString(sha256(csrfToken), csrfTokenHash);

export const revokeSessionToken = async (
  sessionToken: string,
  reason = "LOGOUT"
): Promise<void> => {
  await prisma.userSession.updateMany({
    where: {
      tokenHash: sha256(sessionToken),
      revokedAt: null
    },
    data: {
      revokedAt: now(),
      revokedReason: reason
    }
  });
};

export const revokeAllUserSessions = async (
  userId: string,
  reason = "REVOKED",
  exceptSessionId?: string
): Promise<number> => {
  const result = await prisma.userSession.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {})
    },
    data: {
      revokedAt: now(),
      revokedReason: reason
    }
  });

  return result.count;
};

export const rotateUserSession = async (input: {
  currentSessionToken: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<CreatedSession | null> => {
  const existing = await prisma.userSession.findUnique({
    where: { tokenHash: sha256(input.currentSessionToken) },
    select: { id: true, userId: true, revokedAt: true }
  });

  if (!existing || existing.revokedAt || existing.userId !== input.userId) {
    return null;
  }

  await revokeSessionToken(input.currentSessionToken, "ROTATED");
  return createUserSession({
    userId: input.userId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });
};

export const expireSessionForTest = async (sessionId: string, idleExpired = false): Promise<void> => {
  const expiredAt = new Date(Date.now() - 60_000);
  await prisma.userSession.update({
    where: { id: sessionId },
    data: idleExpired
      ? { idleExpiresAt: expiredAt }
      : { expiresAt: expiredAt, idleExpiresAt: expiredAt }
  });
};
