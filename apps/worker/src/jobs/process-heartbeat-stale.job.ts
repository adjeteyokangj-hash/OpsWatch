import { randomUUID } from "crypto";
import { ProjectStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { dispatchAlertNotifications } from "../services/notifications/notification.service";

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
      status: "OPEN"
    }
  });

  if (existingAlert) {
    const updatedAlert = await prisma.alert.update({
      where: { id: existingAlert.id },
      data: {
        severity,
        message,
        lastSeenAt: new Date()
      }
    });
    if (updatedAlert.severity !== existingAlert.severity) {
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

const resolveHeartbeatStaleAlerts = async (projectId: string): Promise<void> => {
  const openAlerts = await prisma.alert.findMany({
    where: {
      projectId,
      sourceType: "HEARTBEAT",
      title: "Heartbeat stale",
      status: "OPEN"
    },
    select: { id: true }
  });

  for (const openAlert of openAlerts) {
    await prisma.alert.update({
      where: { id: openAlert.id },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        lastSeenAt: new Date()
      }
    });
    await dispatchAlertNotifications(openAlert.id, "resolved");
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

    if (ageMin >= 20) {
      await prisma.project.update({
        where: { id: project.id },
        data: { status: ProjectStatus.DEGRADED }
      });
      await upsertHeartbeatStaleAlert(
        project.id,
        "HIGH",
        `No heartbeat from ${project.slug} for ${Math.floor(ageMin)} minutes`
      );
    } else if (ageMin >= 10) {
      await prisma.project.update({
        where: { id: project.id },
        data: { status: ProjectStatus.DEGRADED }
      });
      await upsertHeartbeatStaleAlert(
        project.id,
        "MEDIUM",
        `No heartbeat from ${project.slug} for ${Math.floor(ageMin)} minutes`
      );
    } else {
      await prisma.project.update({
        where: { id: project.id },
        data: { status: ProjectStatus.HEALTHY }
      });
      await resolveHeartbeatStaleAlerts(project.id);
    }
  }

  logger.info("Processed stale heartbeats");
};
