import crypto from "crypto";
import { prisma } from "../../../lib/prisma";
import type { RemediationExecutor } from "../types";
import { completed, failed, missingContext } from "./_common";

export const executeRotateWebhookSecret: RemediationExecutor = async ({ context, executedBy }) => {
  if (!context.projectId) {
    return missingContext("projectId is required to rotate webhook secret.", ["projectId"]);
  }

  const project = await prisma.project.findUnique({ where: { id: context.projectId } });
  if (!project) {
    return failed("Project not found.");
  }

  const nextSecret = crypto.randomBytes(32).toString("hex");
  await prisma.project.update({
    where: { id: project.id },
    data: { signingSecret: nextSecret }
  });

  await prisma.auditLog.create({
    data: {
      id: crypto.randomUUID(),
      userId: executedBy ?? null,
      action: "ROTATE_WEBHOOK_SECRET",
      entityType: "PROJECT",
      entityId: project.id,
      metadataJson: {
        message: "Webhook signing secret rotated."
      }
    }
  });

  return completed("Webhook secret rotated for project.", {
    projectId: project.id
  });
};
