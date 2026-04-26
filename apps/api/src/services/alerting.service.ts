import { AlertCategory, AlertSeverity, AlertStatus, ProjectStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { dispatchAlertNotifications } from "./notifications/notification.service";

export const createAlert = async (input: {
  projectId: string;
  serviceId?: string;
  sourceType: string;
  sourceId?: string;
  integrationId?: string;
  severity: AlertSeverity;
  category?: AlertCategory;
  title: string;
  message: string;
  dedupeBySourceId?: boolean;
}): Promise<void> => {
  let alertToDispatchId: string | null = null;
  const dedupeBySourceId = input.dedupeBySourceId ?? true;

  const existingAlert = await prisma.alert.findFirst({
    where: {
      projectId: input.projectId,
      serviceId: input.serviceId ?? null,
      sourceType: input.sourceType,
      ...(dedupeBySourceId ? { sourceId: input.sourceId ?? null } : {}),
      title: input.title,
      status: AlertStatus.OPEN
    }
  });

  if (existingAlert) {
    const updatedAlert = await prisma.alert.update({
      where: { id: existingAlert.id },
      data: {
        severity: input.severity,
        ...(input.category ? { category: input.category } : {}),
        ...(input.integrationId ? { integrationId: input.integrationId } : {}),
        message: input.message,
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
        projectId: input.projectId,
        serviceId: input.serviceId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        integrationId: input.integrationId,
        severity: input.severity,
        category: input.category,
        title: input.title,
        message: input.message,
        status: AlertStatus.OPEN
      }
    });
    alertToDispatchId = createdAlert.id;
  }

  if (input.severity === "CRITICAL" || input.severity === "HIGH") {
    await prisma.project.update({
      where: { id: input.projectId },
      data: { status: ProjectStatus.DEGRADED }
    });
  }

  if (alertToDispatchId) {
    await dispatchAlertNotifications(alertToDispatchId, "triggered");
  }
};

export const resolveAlertsBySourceType = async (
  projectId: string,
  sourceType: string,
  title?: string
): Promise<void> => {
  await prisma.alert.updateMany({
    where: {
      projectId,
      sourceType,
      status: AlertStatus.OPEN,
      ...(title ? { title } : {})
    },
    data: {
      status: AlertStatus.RESOLVED,
      resolvedAt: new Date(),
      lastSeenAt: new Date()
    }
  });
};
