import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { sanitizeAppVersion } from "./device-heartbeat";
import {
  pullStaffDirectory,
  USER_OFFLINE_AFTER_SECONDS,
  type ParsedUserSession,
  type SanitizedStaff
} from "./user-monitoring";

export const ingestUserSession = async (
  projectId: string,
  body: { environment?: string; status?: string; appVersion?: unknown; message?: unknown },
  session: ParsedUserSession,
  verifiedUserId: string,
  observedAt = new Date()
): Promise<void> => {
  const appVersion = sanitizeAppVersion(body.appVersion);
  const payloadJson = session.sanitizedPayload as Prisma.InputJsonValue;
  await prisma.heartbeat.create({
    data: {
      id: randomUUID(),
      projectId,
      deviceId: session.installationId,
      environment: String(body.environment || "unknown"),
      appVersion,
      status: String(body.status || "HEALTHY"),
      message: null,
      payloadJson,
      receivedAt: observedAt
    }
  });

  await prisma.monitoredSession.upsert({
    where: { projectId_sessionId: { projectId, sessionId: session.sessionId } },
    create: {
      id: randomUUID(),
      projectId,
      sessionId: session.sessionId,
      userId: verifiedUserId,
      installationId: session.installationId,
      appVersion,
      lifecycleSync: session.lifecycleSync,
      financialSync: session.financialSync,
      lastSuccessfulSyncAt: session.lastSuccessfulSyncAt ? new Date(session.lastSuccessfulSyncAt) : null,
      presence: session.ended ? "ENDED" : "ONLINE",
      endedAt: session.ended ? observedAt : null,
      lastSeenAt: observedAt,
      offlineAfterSeconds: USER_OFFLINE_AFTER_SECONDS,
      sanitizedPayloadJson: payloadJson,
      updatedAt: observedAt
    },
    update: {
      userId: verifiedUserId,
      installationId: session.installationId,
      appVersion,
      lifecycleSync: session.lifecycleSync,
      financialSync: session.financialSync,
      lastSuccessfulSyncAt: session.lastSuccessfulSyncAt ? new Date(session.lastSuccessfulSyncAt) : null,
      presence: session.ended ? "ENDED" : "ONLINE",
      endedAt: session.ended ? observedAt : null,
      lastSeenAt: observedAt,
      sanitizedPayloadJson: payloadJson,
      updatedAt: observedAt
    }
  });
};

/** Replace the mirrored directory. A failed fetch must not call this with an empty guess. */
export const replaceStaffDirectory = async (
  projectId: string,
  staff: SanitizedStaff[],
  observedAt = new Date()
): Promise<number> => {
  const userIds = staff.map((row) => row.userId);
  for (const row of staff) {
    const propertyIds = row.propertyIds as Prisma.InputJsonValue;
    await prisma.monitoredStaff.upsert({
      where: { projectId_userId: { projectId, userId: row.userId } },
      create: {
        id: randomUUID(),
        projectId,
        userId: row.userId,
        displayName: row.displayName,
        role: row.role,
        accountStatus: row.accountStatus,
        propertyAccess: row.propertyAccess,
        propertyIds,
        directorySeenAt: observedAt,
        updatedAt: observedAt
      },
      update: {
        displayName: row.displayName,
        role: row.role,
        accountStatus: row.accountStatus,
        propertyAccess: row.propertyAccess,
        propertyIds,
        directorySeenAt: observedAt,
        updatedAt: observedAt
      }
    });
  }
  await prisma.monitoredStaff.deleteMany({
    where: { projectId, ...(userIds.length > 0 ? { userId: { notIn: userIds } } : {}) }
  });
  return staff.length;
};

export const syncStaffDirectory = async (projectId: string): Promise<number | null> => {
  const staff = await pullStaffDirectory();
  if (!staff) return null;
  return replaceStaffDirectory(projectId, staff);
};
