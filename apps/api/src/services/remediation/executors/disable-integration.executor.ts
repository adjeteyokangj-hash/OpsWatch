import { prisma } from "../../../lib/prisma";
import { randomUUID } from "crypto";
import type { RemediationExecutor } from "../types";
import { completed, failed, missingContext } from "./_common";

export const executeDisableIntegration: RemediationExecutor = async ({ context, executedBy }) => {
  let integrationId = context.integrationId;

  // Auto-resolve: pick the first active notification channel for the project
  // when no explicit integrationId is provided in context.
  if (!integrationId && context.projectId) {
    const hintedType =
      typeof context.extra?.integrationType === "string"
        ? context.extra.integrationType.toUpperCase()
        : undefined;

    const channel = await prisma.notificationChannel.findFirst({
      where: {
        projectId: context.projectId,
        isActive: true,
        ...(hintedType ? { type: hintedType } : {})
      },
      orderBy: { createdAt: "asc" }
    });
    integrationId = channel?.id;
  }

  if (!integrationId) {
    return missingContext(
      "integrationId is required to disable an integration. Provide it explicitly or ensure the incident is linked to a project with an active notification channel.",
      ["integrationId"]
    );
  }

  const channel = await prisma.notificationChannel.findUnique({ where: { id: integrationId } });
  if (!channel) {
    return failed("Integration channel not found.");
  }

  await prisma.notificationChannel.update({
    where: { id: integrationId },
    data: { isActive: false }
  });

  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      userId: executedBy ?? null,
      action: "DISABLE_INTEGRATION",
      entityType: "NOTIFICATION_CHANNEL",
      entityId: channel.id,
      metadataJson: {
        previousIsActive: channel.isActive,
        reason: context.note ?? "Disabled from remediation flow"
      }
    }
  });

  return completed(`Integration ${channel.name} disabled.`, {
    integrationId: channel.id,
    name: channel.name
  });
};
