import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";

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
      await prisma.incident.update({
        where: { id: incident.id },
        data: { status: "RESOLVED", resolvedAt: new Date() }
      });
    }
  }

  logger.info(`Resolved incidents check complete for ${incidents.length} incidents`);
};
