import { prisma } from "../../../lib/prisma";
import { randomUUID } from "crypto";
import type { RemediationExecutor } from "../types";
import { completed, failed } from "./_common";

export const executeRequestHumanReview: RemediationExecutor = async ({ context, executedBy }) => {
  if (!context.incidentId) {
    return failed("incidentId is required for REQUEST_HUMAN_REVIEW.");
  }

  const incident = await prisma.incident.findUnique({ where: { id: context.incidentId } });
  if (!incident) {
    return failed("Incident not found.");
  }

  await prisma.incident.update({
    where: { id: incident.id },
    data: {
      status: incident.status === "OPEN" ? "INVESTIGATING" : incident.status
    }
  });

  const log = await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      userId: executedBy ?? null,
      action: "REQUEST_HUMAN_REVIEW",
      entityType: "INCIDENT",
      entityId: incident.id,
      metadataJson: {
        note: context.note ?? "Human review requested by remediation flow"
      }
    }
  });

  return completed("Human review requested and incident marked for investigation.", {
    incidentId: incident.id,
    reviewLogId: log.id
  });
};
