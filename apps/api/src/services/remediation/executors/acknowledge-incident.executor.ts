import { prisma } from "../../../lib/prisma";
import { randomUUID } from "crypto";
import type { RemediationExecutor } from "../types";
import { completed, failed } from "./_common";

export const executeAcknowledgeIncident: RemediationExecutor = async ({ context, executedBy }) => {
  if (!context.incidentId) {
    return failed("incidentId is required for ACKNOWLEDGE_INCIDENT");
  }

  const incident = await prisma.incident.findUnique({ where: { id: context.incidentId } });
  if (!incident) {
    return failed("Incident not found");
  }

  const now = new Date();
  const updated = await prisma.incident.update({
    where: { id: incident.id },
    data: {
      acknowledgedAt: incident.acknowledgedAt ?? now,
      status: incident.status === "OPEN" ? "INVESTIGATING" : incident.status
    }
  });

  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      userId: executedBy ?? null,
      action: "ACKNOWLEDGE_INCIDENT",
      entityType: "INCIDENT",
      entityId: incident.id,
      metadataJson: {
        previousStatus: incident.status,
        newStatus: updated.status
      }
    }
  });

  return completed(`Incident ${incident.id} acknowledged.`, {
    incidentId: incident.id,
    status: updated.status,
    acknowledgedAt: updated.acknowledgedAt?.toISOString()
  });
};
