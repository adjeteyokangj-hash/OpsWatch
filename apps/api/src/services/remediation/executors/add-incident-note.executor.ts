import { prisma } from "../../../lib/prisma";
import { randomUUID } from "crypto";
import type { RemediationExecutor } from "../types";
import { completed, failed } from "./_common";

export const executeAddIncidentNote: RemediationExecutor = async ({ context, executedBy }) => {
  if (!context.incidentId) {
    return failed("incidentId is required for ADD_INCIDENT_NOTE");
  }

  const note = context.note?.trim() || "Manual remediation note added.";
  const incident = await prisma.incident.findUnique({ where: { id: context.incidentId } });
  if (!incident) {
    return failed("Incident not found");
  }

  const row = await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      userId: executedBy ?? null,
      action: "ADD_INCIDENT_NOTE",
      entityType: "INCIDENT_NOTE",
      entityId: incident.id,
      metadataJson: {
        note,
        addedAt: new Date().toISOString()
      }
    }
  });

  return completed("Incident note added.", {
    incidentId: incident.id,
    noteId: row.id,
    note
  });
};
