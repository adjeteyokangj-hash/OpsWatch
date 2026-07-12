import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";

export type RemediationLockResult =
  | { acquired: true; lockId: string; lockKey: string }
  | { acquired: false; reason: string; heldBy?: string; expiresAt?: Date };

const defaultTtlMs = (): number => {
  const raw = Number(process.env.REMEDIATION_LOCK_TTL_MS || 120_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 120_000;
};

export const buildAutoHealLockKey = (organizationId: string, incidentId: string): string =>
  `auto-heal:${organizationId}:${incidentId}`;

export const buildRemediationLockKey = (
  organizationId: string,
  incidentId: string,
  action: string
): string => `remediation:${organizationId}:${incidentId}:${action}`;

const purgeExpiredLocks = async (lockKey: string): Promise<void> => {
  await prisma.remediationLock.deleteMany({
    where: { lockKey, expiresAt: { lt: new Date() } }
  });
};

export const acquireRemediationLock = async (input: {
  lockKey: string;
  organizationId: string;
  incidentId?: string;
  action?: string;
  holder: string;
  ttlMs?: number;
}): Promise<RemediationLockResult> => {
  const ttlMs = input.ttlMs ?? defaultTtlMs();
  const expiresAt = new Date(Date.now() + ttlMs);

  await purgeExpiredLocks(input.lockKey);

  const existing = await prisma.remediationLock.findUnique({
    where: { lockKey: input.lockKey }
  });
  if (existing && existing.expiresAt > new Date()) {
    return {
      acquired: false,
      reason: "Remediation already running for this scope",
      heldBy: existing.holder,
      expiresAt: existing.expiresAt
    };
  }

  if (existing) {
    await prisma.remediationLock.delete({ where: { lockKey: input.lockKey } });
  }

  try {
    const lock = await prisma.remediationLock.create({
      data: {
        id: randomUUID(),
        lockKey: input.lockKey,
        organizationId: input.organizationId,
        incidentId: input.incidentId,
        action: input.action,
        holder: input.holder,
        expiresAt
      }
    });
    return { acquired: true, lockId: lock.id, lockKey: lock.lockKey };
  } catch {
    const raced = await prisma.remediationLock.findUnique({
      where: { lockKey: input.lockKey }
    });
    if (raced && raced.expiresAt > new Date()) {
      return {
        acquired: false,
        reason: "Remediation already running for this scope",
        heldBy: raced.holder,
        expiresAt: raced.expiresAt
      };
    }
    return { acquired: false, reason: "Unable to acquire remediation lock" };
  }
};

export const releaseRemediationLock = async (lockKey: string, holder: string): Promise<void> => {
  await prisma.remediationLock.deleteMany({
    where: { lockKey, holder }
  });
};

export const findIdempotentRemediationLog = async (
  organizationId: string,
  idempotencyKey: string
) => {
  if (!idempotencyKey.trim()) return null;
  return prisma.remediationLog.findFirst({
    where: { organizationId, idempotencyKey }
  });
};

export const hasInFlightRemediation = async (input: {
  organizationId: string;
  incidentId: string;
  action: string;
  withinMs?: number;
}): Promise<boolean> => {
  const withinMs = input.withinMs ?? defaultTtlMs();
  const row = await prisma.remediationLog.findFirst({
    where: {
      organizationId: input.organizationId,
      incidentId: input.incidentId,
      action: input.action,
      status: "EXECUTING",
      createdAt: { gte: new Date(Date.now() - withinMs) }
    },
    select: { id: true }
  });
  return Boolean(row);
};
