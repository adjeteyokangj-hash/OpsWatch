import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";

const EXPIRING_SOON_MS = 14 * 24 * 60 * 60 * 1000;

export const expireDueCredentials = async (now = new Date()): Promise<number> => {
  const expired = await prisma.managedCredential.updateMany({
    where: {
      status: { in: ["ACTIVE", "GRACE"] },
      expiresAt: { lt: now }
    },
    data: { status: "EXPIRED", updatedAt: now }
  });

  const graceExpired = await prisma.managedCredential.updateMany({
    where: {
      status: "GRACE",
      graceExpiresAt: { lt: now }
    },
    data: { status: "INACTIVE", updatedAt: now }
  });

  return expired.count + graceExpired.count;
};

const markExpiredConnectionHealth = async (now = new Date()): Promise<number> => {
  const expiredFamilies = await prisma.managedCredential.findMany({
    where: {
      purpose: "CONNECTION_AUTH",
      status: "EXPIRED",
      connectionId: { not: null }
    },
    select: { familyId: true, connectionId: true, expiresAt: true }
  });

  let updated = 0;
  for (const row of expiredFamilies) {
    if (!row.connectionId) continue;
    const result = await prisma.connection.updateMany({
      where: {
        id: row.connectionId,
        credentialFamilyId: row.familyId,
        health: { not: "DISCONNECTED" }
      },
      data: {
        health: "DISCONNECTED",
        healthReason: "Connection credential has expired",
        updatedAt: now
      }
    });
    updated += result.count;
  }
  return updated;
};

const warnExpiringSoonConnections = async (now = new Date()): Promise<number> => {
  const threshold = new Date(now.getTime() + EXPIRING_SOON_MS);
  const expiring = await prisma.managedCredential.findMany({
    where: {
      purpose: "CONNECTION_AUTH",
      status: "ACTIVE",
      expiresAt: { gt: now, lte: threshold },
      connectionId: { not: null }
    },
    select: { connectionId: true, expiresAt: true }
  });

  let updated = 0;
  for (const row of expiring) {
    if (!row.connectionId || !row.expiresAt) continue;
    const result = await prisma.connection.updateMany({
      where: {
        id: row.connectionId,
        health: { in: ["HEALTHY", "UNKNOWN"] }
      },
      data: {
        health: "DEGRADED",
        healthReason: `Connection credential expires on ${row.expiresAt.toISOString().slice(0, 10)}`,
        updatedAt: now
      }
    });
    updated += result.count;
  }
  return updated;
};

const createExpiryAlerts = async (now = new Date()): Promise<number> => {
  const expiredConnections = await prisma.connection.findMany({
    where: {
      health: "DISCONNECTED",
      healthReason: "Connection credential has expired",
      projectId: { not: null },
      updatedAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) }
    },
    select: { id: true, projectId: true, name: true }
  });

  let created = 0;
  for (const connection of expiredConnections) {
    if (!connection.projectId) continue;
    const existing = await prisma.alert.findFirst({
      where: {
        projectId: connection.projectId,
        sourceType: "CONNECTION_CREDENTIAL",
        sourceId: connection.id,
        status: "OPEN"
      }
    });
    if (existing) continue;
    await prisma.alert.create({
      data: {
        id: randomUUID(),
        projectId: connection.projectId,
        sourceType: "CONNECTION_CREDENTIAL",
        sourceId: connection.id,
        severity: "HIGH",
        category: "RELIABILITY",
        title: `Credential expired: ${connection.name}`,
        message: "An external connection credential has expired and must be rotated."
      }
    });
    created += 1;
  }
  return created;
};

export const runExpireCredentialsJob = async (): Promise<void> => {
  const now = new Date();
  const transitioned = await expireDueCredentials(now);
  const healthUpdated = await markExpiredConnectionHealth(now);
  const warnings = await warnExpiringSoonConnections(now);
  const alerts = await createExpiryAlerts(now);
  logger.info("expire-credentials job completed", {
    transitioned,
    healthUpdated,
    warnings,
    alerts
  });
};
