import type { Alert, Project, Service } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { sendEmailAlert } from "./email-alert.service";
import { sendWebhookAlert } from "./webhook-alert.service";

type AlertWithRelations = Alert & {
  Project: Project;
  Service: Service | null;
};

const loadAlert = async (alertId: string): Promise<AlertWithRelations | null> => {
  return prisma.alert.findUnique({
    where: { id: alertId },
    include: {
      Project: true,
      Service: true
    }
  });
};

export const dispatchAlertNotifications = async (
  alertId: string,
  reason: "triggered" | "escalated" | "resolved"
): Promise<void> => {
  const alert = await loadAlert(alertId);
  if (!alert) {
    return;
  }

  const channels = await prisma.notificationChannel.findMany({
    where: {
      isActive: true,
      OR: [{ projectId: alert.projectId }, { projectId: null }, { isDefault: true }]
    }
  });

  for (const channel of channels) {
    try {
      if (channel.type === "EMAIL") {
        await sendEmailAlert(channel, alert, reason);
      }

      if (channel.type === "WEBHOOK") {
        await sendWebhookAlert(channel, alert, reason);
      }
    } catch (error) {
      logger.error("Notification dispatch failed", {
        alertId,
        channelId: channel.id,
        channelType: channel.type,
        error: String(error)
      });
    }
  }
};