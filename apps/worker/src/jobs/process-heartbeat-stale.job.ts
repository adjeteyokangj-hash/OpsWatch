import { randomUUID } from "crypto";
import { ProjectStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { dispatchAlertNotifications } from "../services/notifications/notification.service";
import {
  inheritedHeartbeatStatus,
  updateInheritedModuleHeartbeatHealth
} from "../services/inherited-module-heartbeat.service";

/** Matches API heartbeat recovery verification thresholds. */
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

/**
 * When heartbeats are fresh again: mark RECOVERING, then RESOLVED only after
 * consecutive healthy heartbeats over a stable window. Never claim remediation.
 */
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

export const processHeartbeatStaleJob = async (): Promise<void> => {
  const projects = await prisma.project.findMany({ where: { isActive: true } });

  for (const project of projects) {
    const latest = await prisma.heartbeat.findFirst({
      where: { projectId: project.id },
      orderBy: { receivedAt: "desc" }
    });

    if (!latest) {
      continue;
    }

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
