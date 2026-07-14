import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { assertPasswordMeetsPolicy, PasswordPolicyError } from "../utils/password-policy";
import {
  UserManagementError,
  assertCanChangeAdminAccess,
  consolidateDevOrganizationUsers,
  countActiveAdmins,
  getOrgUserOrThrow,
  invitePlatformMember,
  isUserAssignableRole,
  listProjectContactEmails,
  listRegisteredEmails,
  listUserAuditLogs,
  logUserEvent,
  resolvePreferredDevOrganizationId,
  serializeUser,
  serializeUsers
} from "../services/user-management.service";
import { setPlatformSuperAdminFlag } from "../services/platform-super-admin-column";
import { revokeAllUserSessions } from "../services/session.service";
import { handleEntitlementFailure } from "./subscription.controller";
import { assertWithinLimit } from "../services/entitlements/entitlement.service";
import { ENTITLEMENT } from "../services/entitlements/entitlement-keys";

const isUniqueEmailError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002" &&
  (error.meta?.target as string[] | undefined)?.includes("email") === true;

const orgIdOr403 = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

const userIdOr400 = (req: AuthRequest, res: Response): string | null => {
  const userId = req.params.userId;
  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return null;
  }
  return userId;
};

const handleUserManagementError = (res: Response, error: unknown): boolean => {
  if (error instanceof UserManagementError) {
    res.status(400).json({ error: error.message });
    return true;
  }
  if (error instanceof PasswordPolicyError) {
    res.status(400).json({ error: error.message });
    return true;
  }
  return false;
};

export const registerUser = async (req: AuthRequest, res: Response) => {
  const { name, email, password, organizationId } = req.body ?? {};
  if (!email || !password || !organizationId) {
    res.status(400).json({ error: "email, password, organizationId are required" });
    return;
  }
  const passwordHash = await bcrypt.hash(String(password), 10);
  try {
    const row = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: String(name || email),
        email: String(email),
        passwordHash,
        organizationId: String(organizationId),
        role: "MEMBER",
        updatedAt: new Date()
      }
    });
    res.status(201).json(serializeUser(row));
  } catch (error) {
    if (isUniqueEmailError(error)) {
      res.status(409).json({ error: "A user with this email already exists." });
      return;
    }
    throw error;
  }
};

export const inviteUser = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  const { name, email, role, password } = req.body ?? {};
  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }
  if (role && !isUserAssignableRole(String(role))) {
    res.status(400).json({ error: "Invalid role" });
    return;
  }
  if (!password) {
    res.status(400).json({ error: "password is required" });
    return;
  }

  try {
    assertPasswordMeetsPolicy(String(password));
  } catch (error) {
    if (handleUserManagementError(res, error)) return;
    throw error;
  }

  try {
    await assertWithinLimit(orgId, ENTITLEMENT.TEAM_MEMBERS_MAX);
  } catch (error) {
    if (handleEntitlementFailure(res, error)) return;
    throw error;
  }

  const passwordHash = await bcrypt.hash(String(password), 10);

  try {
    const { user: row, outcome } = await invitePlatformMember({
      organizationId: orgId,
      name: String(name || email),
      email: String(email),
      role: role || "MEMBER",
      passwordHash
    });

    if (outcome === "created") {
      await logUserEvent({
        actorUserId: req.user?.sub,
        action: "USER_CREATED",
        entityId: row.id,
        metadata: { email: row.email, role: row.role }
      });
      res.status(201).json({ ...serializeUser(row), inviteOutcome: outcome });
      return;
    }

    if (outcome === "reattached") {
      await logUserEvent({
        actorUserId: req.user?.sub,
        action: "USER_REATTACHED",
        entityId: row.id,
        metadata: { email: row.email, role: row.role, organizationId: orgId }
      });
      res.status(201).json({ ...serializeUser(row), inviteOutcome: outcome });
      return;
    }

    res.status(200).json({ ...serializeUser(row), inviteOutcome: outcome });
  } catch (error) {
    if (isUniqueEmailError(error)) {
      res.status(409).json({ error: "A user with this email already exists." });
      return;
    }
    throw error;
  }
};

const resolveOrganizationScope = async (orgId: string): Promise<string> => {
  if (process.env.NODE_ENV === "production") {
    return orgId;
  }

  await consolidateDevOrganizationUsers();
  return (await resolvePreferredDevOrganizationId()) ?? orgId;
};

export const getManagementCenter = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;

  const scopeOrgId = await resolveOrganizationScope(orgId);

  const [users, registeredEmails, auditLogs, activeAdminCount, projectContactEmails] = await Promise.all([
    prisma.user.findMany({ where: { organizationId: scopeOrgId }, orderBy: { createdAt: "desc" } }),
    listRegisteredEmails(scopeOrgId),
    listUserAuditLogs(scopeOrgId, 100),
    countActiveAdmins(scopeOrgId),
    listProjectContactEmails(scopeOrgId)
  ]);

  res.json({
    users: await serializeUsers(users),
    registeredEmails,
    auditLogs,
    activeAdminCount,
    projectContactEmails
  });
};

export const listUsers = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;

  const scopeOrgId = await resolveOrganizationScope(orgId);
  const rows = await prisma.user.findMany({ where: { organizationId: scopeOrgId }, orderBy: { createdAt: "desc" } });
  res.json(await serializeUsers(rows));
};

export const listUserAuditLogsHandler = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  res.json(await listUserAuditLogs(orgId, 200));
};

export const getUserById = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  const userId = userIdOr400(req, res);
  if (!userId) return;
  try {
    const user = await getOrgUserOrThrow(orgId, userId);
    const [serialized] = await serializeUsers([user]);
    res.json(serialized);
  } catch (error) {
    if (handleUserManagementError(res, error)) return;
    throw error;
  }
};

export const patchUser = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  const userId = userIdOr400(req, res);
  if (!userId) return;

  try {
    const existing = await getOrgUserOrThrow(orgId, userId);
    const body = req.body ?? {};

    if (body.role !== undefined) {
      if (!isUserAssignableRole(String(body.role))) {
        res.status(400).json({ error: "Invalid role" });
        return;
      }
      await assertCanChangeAdminAccess(orgId, existing.id, { nextRole: String(body.role) });
    }

    if (body.isActive === false) {
      await assertCanChangeAdminAccess(orgId, existing.id, { deactivate: true });
    }

    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...(body.name !== undefined ? { name: String(body.name) } : {}),
        ...(body.role !== undefined ? { role: String(body.role) } : {}),
        ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
        updatedAt: new Date()
      }
    });

    if (body.role !== undefined && body.role !== existing.role) {
      await revokeAllUserSessions(updated.id, "ROLE_CHANGED");
      await logUserEvent({
        actorUserId: req.user?.sub,
        action: "USER_ROLE_UPDATED",
        entityId: updated.id,
        metadata: { email: updated.email, fromRole: existing.role, toRole: updated.role }
      });
    }

    if (body.isActive !== undefined && body.isActive !== existing.isActive) {
      if (!body.isActive) {
        await revokeAllUserSessions(updated.id, "USER_DEACTIVATED");
      }
      await logUserEvent({
        actorUserId: req.user?.sub,
        action: body.isActive ? "USER_REACTIVATED" : "USER_DEACTIVATED",
        entityId: updated.id,
        metadata: { email: updated.email }
      });
    }

    res.json(serializeUser(updated));
  } catch (error) {
    if (handleUserManagementError(res, error)) return;
    throw error;
  }
};

export const resetUserPasswordHandler = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  const userId = userIdOr400(req, res);
  if (!userId) return;
  const { password } = req.body ?? {};
  if (!password) {
    res.status(400).json({ error: "password is required" });
    return;
  }

  try {
    assertPasswordMeetsPolicy(String(password));
    const user = await getOrgUserOrThrow(orgId, userId);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(String(password), 10),
        updatedAt: new Date()
      }
    });
    await revokeAllUserSessions(user.id, "PASSWORD_RESET");
    await logUserEvent({
      actorUserId: req.user?.sub,
      action: "USER_PASSWORD_RESET",
      entityId: user.id,
      metadata: { email: user.email }
    });
    res.json({ ok: true });
  } catch (error) {
    if (handleUserManagementError(res, error)) return;
    throw error;
  }
};

export const deactivateUserHandler = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  const userId = userIdOr400(req, res);
  if (!userId) return;

  if (req.user?.sub === userId) {
    res.status(400).json({ error: "You cannot deactivate your own account." });
    return;
  }

  try {
    await assertCanChangeAdminAccess(orgId, userId, { deactivate: true });
    const user = await getOrgUserOrThrow(orgId, userId);
    if (!user.isActive) {
      res.json(serializeUser(user));
      return;
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false, updatedAt: new Date() }
    });
    await revokeAllUserSessions(updated.id, "USER_DEACTIVATED");
    await logUserEvent({
      actorUserId: req.user?.sub,
      action: "USER_DEACTIVATED",
      entityId: updated.id,
      metadata: { email: updated.email }
    });
    res.json(serializeUser(updated));
  } catch (error) {
    if (handleUserManagementError(res, error)) return;
    throw error;
  }
};

export const reactivateUserHandler = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  const userId = userIdOr400(req, res);
  if (!userId) return;

  try {
    const user = await getOrgUserOrThrow(orgId, userId);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { isActive: true, updatedAt: new Date() }
    });
    await logUserEvent({
      actorUserId: req.user?.sub,
      action: "USER_REACTIVATED",
      entityId: updated.id,
      metadata: { email: updated.email }
    });
    res.json(serializeUser(updated));
  } catch (error) {
    if (handleUserManagementError(res, error)) return;
    throw error;
  }
};

export const setPlatformSuperAdminHandler = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  const userId = userIdOr400(req, res);
  if (!userId) return;

  const enabled = Boolean(req.body?.enabled);
  if (req.user?.sub === userId && !enabled) {
    res.status(400).json({ error: "You cannot remove your own platform super admin access." });
    return;
  }

  try {
    const user = await getOrgUserOrThrow(orgId, userId);
    await setPlatformSuperAdminFlag(user.id, enabled);
    await logUserEvent({
      actorUserId: req.user?.sub,
      action: enabled ? "USER_PLATFORM_SUPER_ADMIN_GRANTED" : "USER_PLATFORM_SUPER_ADMIN_REVOKED",
      entityId: user.id,
      metadata: { email: user.email }
    });
    res.json(
      serializeUser({
        ...user,
        isPlatformSuperAdmin: enabled
      })
    );
  } catch (error) {
    if (handleUserManagementError(res, error)) return;
    if (error instanceof Error && /Failed to ensure User\.isPlatformSuperAdmin/i.test(error.message)) {
      res.status(503).json({ error: error.message });
      return;
    }
    throw error;
  }
};

export const deleteUser = deactivateUserHandler;
