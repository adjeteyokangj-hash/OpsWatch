import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { randomUUID } from "crypto";

export const resolveIncidentsJob = async (): Promise<void> => {
  const incidents = await prisma.incident.findMany({
    where: { status: { in: ["OPEN", "INVESTIGATING", "MONITORING"] } },
    include: {
      IncidentAlert: {
        include: {
          Alert: true
        }
      }
    }
  });

  for (const incident of incidents) {
    const hasOpenAlert = incident.IncidentAlert.some((ref) => ref.Alert.status !== "RESOLVED");
    if (!hasOpenAlert) {
      const resolvedAt = new Date();
      await prisma.$transaction([
        prisma.incident.update({ where: { id: incident.id }, data: { status: "RESOLVED", resolvedAt } }),
        prisma.incidentTimelineEvent.create({ data: { id: randomUUID(), incidentId: incident.id, projectId: incident.projectId, eventType: "INCIDENT_RESOLVED", summary: "Incident resolved after all correlated alerts recovered", sourceType: "INCIDENT", sourceId: incident.id, occurredAt: resolvedAt } })
      ]);
    }
  }

  logger.info(`Resolved incidents check complete for ${incidents.length} incidents`);
};
