import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { assertPasswordMeetsPolicy, PasswordPolicyError } from "../utils/password-policy";
import { revokeAllUserSessions } from "./session.service";
import type { CreatedSession, SessionUser } from "./session.service";
import { createUserSession } from "./session.service";

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_CREDENTIALS" | "PASSWORD_REUSE" | "INACTIVE"
  ) {
    super(message);
    this.name = "AuthError";
  }
}

const toSessionUser = (user: {
  id: string;
  email: string;
  role: string;
  organizationId: string | null;
  name: string;
}): SessionUser => ({
  id: user.id,
  email: user.email,
  role: user.role,
  organizationId: user.organizationId,
  name: user.name
});

export const login = async (
  email: string,
  password: string,
  context: { ipAddress?: string; userAgent?: string } = {}
): Promise<{ user: SessionUser; session: CreatedSession }> => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    throw new Error("Invalid credentials");
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    throw new Error("Invalid credentials");
  }

  await revokeAllUserSessions(user.id, "LOGIN_ROTATION");

  const session = await createUserSession({
    userId: user.id,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent
  });

  return {
    user: toSessionUser(user),
    session
  };
};

export const getSessionUser = async (userId: string): Promise<SessionUser | null> => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) {
    return null;
  }

  return toSessionUser(user);
};

export const changePassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) {
    throw new AuthError("Invalid credentials", "INVALID_CREDENTIALS");
  }

  const currentValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!currentValid) {
    throw new AuthError("Invalid credentials", "INVALID_CREDENTIALS");
  }

  assertPasswordMeetsPolicy(newPassword);

  if (currentPassword === newPassword) {
    throw new AuthError("New password must differ from the current password", "PASSWORD_REUSE");
  }

  const reusesExistingHash = await bcrypt.compare(newPassword, user.passwordHash);
  if (reusesExistingHash) {
    throw new AuthError("New password must differ from the current password", "PASSWORD_REUSE");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      updatedAt: new Date()
    }
  });

  await revokeAllUserSessions(userId, "PASSWORD_CHANGED");

  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      userId,
      action: "PASSWORD_CHANGED",
      entityType: "USER",
      entityId: userId,
      metadataJson: {
        email: user.email
      } as unknown as Prisma.InputJsonValue
    }
  });
};

export { PasswordPolicyError };
