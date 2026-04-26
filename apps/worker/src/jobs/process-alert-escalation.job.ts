import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { dispatchAlertNotifications } from "../services/notifications/notification.service";

export const processAlertEscalationJob = async (): Promise<void> => {
  const alerts = await prisma.alert.findMany({
    where: { status: "OPEN" },
    orderBy: { firstSeenAt: "asc" }
  });

  for (const alert of alerts) {
    const ageMinutes = (Date.now() - alert.firstSeenAt.getTime()) / 60000;
    if (ageMinutes > 30 && alert.severity === "MEDIUM") {
      const updatedAlert = await prisma.alert.update({ where: { id: alert.id }, data: { severity: "HIGH" } });
      await dispatchAlertNotifications(updatedAlert.id, "escalated");
    }
    if (ageMinutes > 60 && alert.severity === "HIGH") {
      const updatedAlert = await prisma.alert.update({ where: { id: alert.id }, data: { severity: "CRITICAL" } });
      await dispatchAlertNotifications(updatedAlert.id, "escalated");
    }
  }

  logger.info(`Escalation processed for ${alerts.length} alerts`);
};
