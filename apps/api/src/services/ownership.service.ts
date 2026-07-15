import { prisma } from "../lib/prisma";

export type OwnershipFields = {
  ownerUserId: string | null;
  ownerTeam: string | null;
  runbookUrl: string | null;
  escalationContact: string | null;
};

const normalizeOptional = (value: unknown): string | null => {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
};

export const ownershipFromBody = (body: Record<string, unknown>): Partial<OwnershipFields> => {
  const patch: Partial<OwnershipFields> = {};
  if ("ownerUserId" in body) patch.ownerUserId = normalizeOptional(body.ownerUserId);
  if ("ownerTeam" in body) patch.ownerTeam = normalizeOptional(body.ownerTeam);
  if ("runbookUrl" in body) patch.runbookUrl = normalizeOptional(body.runbookUrl);
  if ("escalationContact" in body) {
    patch.escalationContact = normalizeOptional(body.escalationContact);
  }
  return patch;
};

export const assertOwnerInOrganization = async (
  organizationId: string,
  ownerUserId: string | null | undefined
): Promise<{ ok: true } | { ok: false; error: string }> => {
  if (!ownerUserId) return { ok: true };
  const user = await prisma.user.findFirst({
    where: { id: ownerUserId, organizationId, isActive: true },
    select: { id: true }
  });
  if (!user) return { ok: false, error: "ownerUserId is not an active member of this organization" };
  return { ok: true };
};

export const getServiceOwnership = async (
  organizationId: string,
  serviceId: string
): Promise<(OwnershipFields & { serviceId: string; name: string }) | null> => {
  const row = await prisma.service.findFirst({
    where: { id: serviceId, Project: { organizationId } },
    select: {
      id: true,
      name: true,
      ownerUserId: true,
      ownerTeam: true,
      runbookUrl: true,
      escalationContact: true
    }
  });
  if (!row) return null;
  return {
    serviceId: row.id,
    name: row.name,
    ownerUserId: row.ownerUserId,
    ownerTeam: row.ownerTeam,
    runbookUrl: row.runbookUrl,
    escalationContact: row.escalationContact
  };
};

export const updateServiceOwnership = async (
  organizationId: string,
  serviceId: string,
  patch: Partial<OwnershipFields>
): Promise<(OwnershipFields & { serviceId: string }) | null | { error: string; status: number }> => {
  const existing = await prisma.service.findFirst({
    where: { id: serviceId, Project: { organizationId } },
    select: { id: true }
  });
  if (!existing) return null;

  const ownerCheck = await assertOwnerInOrganization(organizationId, patch.ownerUserId);
  if (!ownerCheck.ok) return { error: ownerCheck.error, status: 400 };

  const updated = await prisma.service.update({
    where: { id: serviceId },
    data: { ...patch, updatedAt: new Date() },
    select: {
      id: true,
      ownerUserId: true,
      ownerTeam: true,
      runbookUrl: true,
      escalationContact: true
    }
  });

  return {
    serviceId: updated.id,
    ownerUserId: updated.ownerUserId,
    ownerTeam: updated.ownerTeam,
    runbookUrl: updated.runbookUrl,
    escalationContact: updated.escalationContact
  };
};
