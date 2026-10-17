import { randomUUID } from "crypto";
import { ProjectStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { dispatchAlertNotifications } from "../services/notifications/notification.service";
import {
  inheritedHeartbeatStatus,
  updateInheritedModuleHeartbeatHealth,
  updateRuntimeEvidenceHeartbeatHealth
} from "../services/inherited-module-heartbeat.service";

const DEVICE_OFFLINE_AFTER_SECONDS = 10 * 60;
const HEARTBEAT_RECOVERY_MIN_COUNT = 3;
const HEARTBEAT_RECOVERY_STABLE_SECONDS = 180;

const OPEN_HEARTBEAT_STATUSES = ["OPEN", "ACKNOWLEDGED", "RECOVERING", "VERIFYING", "REMEDIATING"] as const;

const upsertHeartbeatStaleAlert = async (
  projectId: string,
  severity: "MEDIUM" | "HIGH",
  message: string
): Promise<void> => {
  let alertToDispatchId: string | null = null;
  const existingAlert = await prisma.alert.findFirst({
    where: {
      projectId,
      sourceType: "HEARTBEAT",
      title: "Heartbeat stale",
      status: { in: [...OPEN_HEARTBEAT_STATUSES] }
    }
  });

  if (existingAlert) {
    const updatedAlert = await prisma.alert.update({
      where: { id: existingAlert.id },
      data: {
        status: "OPEN",
        severity,
        message: message.replace(/\s*\[recovering:.*?\]/g, "").replace(/\s*\[auto-resolved:.*?\]/g, ""),
        lastSeenAt: new Date(),
        resolvedAt: null
      }
    });
    if (updatedAlert.severity !== existingAlert.severity || existingAlert.status !== "OPEN") {
      alertToDispatchId = updatedAlert.id;
    }
  } else {
    const createdAlert = await prisma.alert.create({
      data: {
        id: randomUUID(),
        projectId,
        sourceType: "HEARTBEAT",
        severity,
        title: "Heartbeat stale",
        message
      }
    });
    alertToDispatchId = createdAlert.id;
  }

  if (alertToDispatchId) {
    await dispatchAlertNotifications(alertToDispatchId, "triggered");
  }
};

const progressHeartbeatStaleRecovery = async (projectId: string): Promise<void> => {
  const alerts = await prisma.alert.findMany({
    where: {
      projectId,
      sourceType: "HEARTBEAT",
      title: "Heartbeat stale",
      status: { in: [...OPEN_HEARTBEAT_STATUSES] }
    }
  });

  if (alerts.length === 0) return;

  const heartbeats = await prisma.heartbeat.findMany({
    where: { projectId, status: { not: "DOWN" } },
    orderBy: { receivedAt: "desc" },
    take: HEARTBEAT_RECOVERY_MIN_COUNT,
    select: { id: true, receivedAt: true, status: true }
  });

  const verified =
    heartbeats.length >= HEARTBEAT_RECOVERY_MIN_COUNT &&
    heartbeats.every((row) => row.status !== "DOWN") &&
    (() => {
      const newest = heartbeats[0]?.receivedAt?.getTime() ?? 0;
      const oldest = heartbeats[heartbeats.length - 1]?.receivedAt?.getTime() ?? 0;
      return newest - oldest >= HEARTBEAT_RECOVERY_STABLE_SECONDS * 1000;
    })();

  for (const alert of alerts) {
    if (verified) {
      await prisma.alert.update({
        where: { id: alert.id },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
          lastSeenAt: new Date(),
          message: `${alert.message.replace(/\s*\[recovering:.*?\]/g, "").replace(/\s*\[auto-resolved:.*?\]/g, "")} [auto-resolved: ${HEARTBEAT_RECOVERY_MIN_COUNT} consecutive healthy heartbeats over ≥${HEARTBEAT_RECOVERY_STABLE_SECONDS}s; remediationCausedRecovery=false]`
        }
      });
      await dispatchAlertNotifications(alert.id, "resolved");
      continue;
    }

    if (alert.status === "OPEN" || alert.status === "ACKNOWLEDGED") {
      try {
        await prisma.alert.update({
          where: { id: alert.id },
          data: {
            status: "RECOVERING",
            lastSeenAt: new Date(),
            message: `${alert.message.replace(/\s*\[recovering:.*?\]/g, "")} [recovering: awaiting ${HEARTBEAT_RECOVERY_MIN_COUNT} healthy heartbeats]`
          }
        });
      } catch {
        await prisma.alert.update({
          where: { id: alert.id },
          data: {
            lastSeenAt: new Date(),
            message: `${alert.message.replace(/\s*\[recovering:.*?\]/g, "")} [recovering: awaiting ${HEARTBEAT_RECOVERY_MIN_COUNT} healthy heartbeats]`
          }
        });
      }
    }
  }
};

/**
 * A quiet computer becomes Offline. This does not open an alert or change the
 * parent project: a switched-off reception PC is not an application failure.
 */
export const markSilentMonitoredDevicesOffline = async (now = new Date()): Promise<number> => {
  const delegate = (prisma as unknown as {
    monitoredDevice?: {
      findMany(args: unknown): Promise<Array<{ id: string; lastSeenAt: Date; offlineAfterSeconds: number }>>;
      update(args: unknown): Promise<unknown>;
    };
  }).monitoredDevice;
  if (!delegate) return 0;

  const rows = await delegate.findMany({
    where: { presence: "ONLINE" },
    select: { id: true, lastSeenAt: true, offlineAfterSeconds: true }
  });
  let updated = 0;
  for (const row of rows) {
    const limitSeconds = row.offlineAfterSeconds > 0 ? row.offlineAfterSeconds : DEVICE_OFFLINE_AFTER_SECONDS;
    if (now.getTime() - new Date(row.lastSeenAt).getTime() < limitSeconds * 1000) continue;
    await delegate.update({
      where: { id: row.id },
      data: { presence: "OFFLINE", updatedAt: now }
    });
    updated += 1;
  }
  return updated;
};

/** A quiet session becomes Offline. This does not open an alert or change the project. */
export const markSilentMonitoredSessionsOffline = async (now = new Date()): Promise<number> => {
  const delegate = (prisma as unknown as {
    monitoredSession?: {
      findMany(args: unknown): Promise<Array<{ id: string; lastSeenAt: Date; offlineAfterSeconds: number; endedAt: Date | null }>>;
      update(args: unknown): Promise<unknown>;
    };
  }).monitoredSession;
  if (!delegate) return 0;

  const rows = await delegate.findMany({
    where: { presence: "ONLINE", endedAt: null },
    select: { id: true, lastSeenAt: true, offlineAfterSeconds: true, endedAt: true }
  });
  let updated = 0;
  for (const row of rows) {
    const limitSeconds = row.offlineAfterSeconds > 0 ? row.offlineAfterSeconds : DEVICE_OFFLINE_AFTER_SECONDS;
    if (now.getTime() - new Date(row.lastSeenAt).getTime() < limitSeconds * 1000) continue;
    await delegate.update({
      where: { id: row.id },
      data: { presence: "OFFLINE", updatedAt: now }
    });
    updated += 1;
  }
  return updated;
};

export const processHeartbeatStaleJob = async (): Promise<void> => {
  try {
    await markSilentMonitoredDevicesOffline();
  } catch (error) {
    logger.error("Monitored device presence sweep failed", error);
  }
  try {
    await markSilentMonitoredSessionsOffline();
  } catch (error) {
    logger.error("Monitored session presence sweep failed", error);
  }

  const projects = await prisma.project.findMany({ where: { isActive: true } });

  for (const project of projects) {
    const latest = await prisma.heartbeat.findFirst({
      where: { projectId: project.id, deviceId: null },
      orderBy: { receivedAt: "desc" }
    });

    if (!latest) continue;

    const ageMs = Date.now() - latest.receivedAt.getTime();
    const ageMin = ageMs / 60000;
    const inheritedStatus = inheritedHeartbeatStatus({
      heartbeatStatus: latest.status,
      ageMinutes: ageMin
    });

    await prisma.project.update({
      where: { id: project.id },
      data: { status: inheritedStatus }
    });
    await updateInheritedModuleHeartbeatHealth({
      projectId: project.id,
      organizationId: project.organizationId,
      heartbeatStatus: latest.status,
      ageMinutes: ageMin,
      observedAt: latest.receivedAt
    });
    await updateRuntimeEvidenceHeartbeatHealth({
      projectId: project.id,
      organizationId: project.organizationId,
      ageMinutes: ageMin,
      observedAt: latest.receivedAt
    });

    if (ageMin >= 20) {
      await upsertHeartbeatStaleAlert(
        project.id,
        "HIGH",
        `No heartbeat from ${project.slug} for ${Math.floor(ageMin)} minutes`
      );
    } else if (ageMin >= 10) {
      await upsertHeartbeatStaleAlert(
        project.id,
        "MEDIUM",
        `No heartbeat from ${project.slug} for ${Math.floor(ageMin)} minutes`
      );
    } else if (inheritedStatus === ProjectStatus.HEALTHY) {
      await progressHeartbeatStaleRecovery(project.id);
    }
  }

  logger.info("Processed stale heartbeats");
};
