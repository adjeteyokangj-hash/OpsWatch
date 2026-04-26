import type { Alert, Project, Service } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../config/logger";
import { sendEmailAlert } from "./email-alert.service";
import { sendWebhookAlert } from "./webhook-alert.service";

type AlertWithRelations = Alert & {
  Project: Project;
  Service: Service | null;
};

type ChannelKind = "EMAIL" | "WEBHOOK";

export interface NotificationDispatchSummary {
  attempted: number;
  succeeded: number;
  failed: number;
}

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
  reason: "triggered" | "escalated",
  filterType?: ChannelKind
): Promise<NotificationDispatchSummary> => {
  const alert = await loadAlert(alertId);
  if (!alert) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  const channels = await prisma.notificationChannel.findMany({
    where: {
      isActive: true,
      OR: [{ projectId: alert.projectId }, { projectId: null }, { isDefault: true }]
    }
  });

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  for (const channel of channels) {
    if (filterType && channel.type !== filterType) {
      continue;
    }

    attempted += 1;
    try {
      if (channel.type === "EMAIL") {
        await sendEmailAlert(channel, alert, reason);
      }

      if (channel.type === "WEBHOOK") {
        await sendWebhookAlert(channel, alert, reason);
      }
      succeeded += 1;
    } catch (error) {
      failed += 1;
      logger.error("Notification dispatch failed", {
        alertId,
        channelId: channel.id,
        channelType: channel.type,
        error: String(error)
      });
    }
  }

  return { attempted, succeeded, failed };
};

export const redeliverAlertNotifications = async (
  alertId: string,
  filterType: ChannelKind
): Promise<NotificationDispatchSummary> => {
  return dispatchAlertNotifications(alertId, "triggered", filterType);
};