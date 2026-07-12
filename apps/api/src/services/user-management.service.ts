import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";

export class UserManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserManagementError";
  }
}

export const USER_ASSIGNABLE_ROLES = [
  "ADMIN",
  "MEMBER",
  "VIEWER",
  "INCIDENT_RESPONDER",
  "AUTOMATION_OPERATOR"
] as const;

export type UserAssignableRole = (typeof USER_ASSIGNABLE_ROLES)[number];

export const isUserAssignableRole = (role: string): role is UserAssignableRole =>
  USER_ASSIGNABLE_ROLES.includes(role as UserAssignableRole);

export const serializeUser = (user: {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
}) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  createdAt: user.createdAt.toISOString()
});

export const countActiveAdmins = async (organizationId: string): Promise<number> =>
  prisma.user.count({
    where: {
      organizationId,
      role: "ADMIN",
      isActive: true
    }
  });

export const getOrgUserOrThrow = async (organizationId: string, userId: string) => {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId }
  });
  if (!user) {
    throw new UserManagementError("User not found");
  }
  return user;
};

export const assertCanChangeAdminAccess = async (
  organizationId: string,
  targetUserId: string,
  options: { nextRole?: string; deactivate?: boolean }
): Promise<void> => {
  const target = await getOrgUserOrThrow(organizationId, targetUserId);
  if (target.role !== "ADMIN" || !target.isActive) {
    return;
  }

  const demoting = options.nextRole !== undefined && options.nextRole !== "ADMIN";
  if (!options.deactivate && !demoting) {
    return;
  }

  const activeAdmins = await countActiveAdmins(organizationId);
  if (activeAdmins <= 1) {
    throw new UserManagementError("Cannot demote or deactivate the last active admin.");
  }
};

export const logUserEvent = async (input: {
  actorUserId?: string;
  action: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> => {
  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      userId: input.actorUserId ?? null,
      action: input.action,
      entityType: "USER",
      entityId: input.entityId,
      metadataJson: (input.metadata ?? {}) as Prisma.InputJsonValue
    }
  });
};

export type InvitePlatformMemberInput = {
  organizationId: string;
  name: string;
  email: string;
  role: string;
  passwordHash: string;
};

export type InvitePlatformMemberResult = {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
    createdAt: Date;
  };
  outcome: "created" | "reattached" | "already_in_org";
};

export const invitePlatformMember = async (
  input: InvitePlatformMemberInput
): Promise<InvitePlatformMemberResult> => {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });

  if (!existing) {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: input.name,
        email: input.email,
        role: input.role,
        passwordHash: input.passwordHash,
        organizationId: input.organizationId,
        updatedAt: new Date()
      }
    });
    return { user, outcome: "created" };
  }

  if (existing.organizationId === input.organizationId) {
    return { user: existing, outcome: "already_in_org" };
  }

  const user = await prisma.user.update({
    where: { id: existing.id },
    data: {
      organizationId: input.organizationId,
      name: input.name,
      role: input.role,
      passwordHash: input.passwordHash,
      isActive: true,
      updatedAt: new Date()
    }
  });

  return { user, outcome: "reattached" };
};

export const resolvePreferredDevOrganizationId = async (): Promise<string | null> => {
  const preferred = await prisma.organization.findFirst({
    where: { slug: { in: ["okanggroup", "opswatch-default"] } },
    orderBy: { Project: { _count: "desc" } },
    select: { id: true }
  });
  return preferred?.id ?? null;
};

export const consolidateDevOrganizationUsers = async (): Promise<number> => {
  if (process.env.NODE_ENV === "production") {
    return 0;
  }

  const targetOrganizationId = await resolvePreferredDevOrganizationId();
  if (!targetOrganizationId) {
    return 0;
  }

  const result = await prisma.user.updateMany({
    where: { organizationId: { not: targetOrganizationId } },
    data: { organizationId: targetOrganizationId, updatedAt: new Date() }
  });

  return result.count;
};

export type ProjectContactEmailRow = {
  projectId: string;
  projectName: string;
  projectOwner: string | null;
  operationalContact: string | null;
  notificationEmails: string[];
};

export const listProjectContactEmails = async (organizationId: string): Promise<ProjectContactEmailRow[]> => {
  const rows = await prisma.project.findMany({
    where: { organizationId },
    select: {
      id: true,
      name: true,
      projectOwner: true,
      operationalContact: true,
      NotificationChannel: {
        where: { isActive: true, type: { in: ["EMAIL", "email"] } },
        select: { target: true }
      }
    },
    orderBy: { name: "asc" }
  });

  return rows.map((row) => ({
    projectId: row.id,
    projectName: row.name,
    projectOwner: row.projectOwner,
    operationalContact: row.operationalContact,
    notificationEmails: row.NotificationChannel.map((channel) => channel.target).filter(Boolean)
  }));
};

export const listRegisteredEmails = async (organizationId: string): Promise<string[]> => {
  const rows = await prisma.user.findMany({
    where: { organizationId },
    select: { email: true },
    orderBy: { email: "asc" }
  });
  return rows.map((row) => row.email);
};

export const listUserAuditLogs = async (organizationId: string, limit = 100) => {
  const orgUsers = await prisma.user.findMany({
    where: { organizationId },
    select: { id: true, email: true, name: true }
  });
  const userIds = orgUsers.map((row) => row.id);
  if (userIds.length === 0) {
    return [];
  }

  const rows = await prisma.auditLog.findMany({
    where: {
      OR: [{ entityType: "USER", entityId: { in: userIds } }, { userId: { in: userIds } }]
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      User: {
        select: { id: true, email: true, name: true }
      }
    }
  });

  const userLookup = new Map(orgUsers.map((row) => [row.id, row]));

  return rows.map((row) => {
    const subject = userLookup.get(row.entityId);
    return {
      id: row.id,
      action: row.action,
      entityId: row.entityId,
      subjectEmail: subject?.email ?? null,
      subjectName: subject?.name ?? null,
      actor: row.User
        ? { id: row.User.id, email: row.User.email, name: row.User.name }
        : null,
      metadata: row.metadataJson,
      createdAt: row.createdAt.toISOString()
    };
  });
};
