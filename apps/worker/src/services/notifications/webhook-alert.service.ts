import type { Alert, NotificationChannel, Project, Service } from "@prisma/client";

type AlertWithRelations = Alert & {
  Project: Project;
  Service: Service | null;
};

export const sendWebhookAlert = async (
  channel: NotificationChannel,
  alert: AlertWithRelations,
  reason: string
): Promise<void> => {
  const response = await fetch(channel.target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text: `OpsWatch ${reason}: ${alert.Project.name}${alert.Service ? ` / ${alert.Service.name}` : ""} ${alert.severity} ${alert.title}`,
      alert: {
        id: alert.id,
        projectId: alert.projectId,
        serviceId: alert.serviceId,
        severity: alert.severity,
        status: alert.status,
        title: alert.title,
        message: alert.message,
        reason
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Webhook request failed with ${response.status}`);
  }
};