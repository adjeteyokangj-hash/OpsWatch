import { prisma } from "../../../lib/prisma";
import type { RemediationContext } from "../types";

export const resolveScope = async (context: RemediationContext): Promise<{
  projectId?: string;
  serviceId?: string;
  alertIds: string[];
}> => {
  let projectId = context.projectId;
  let serviceId = context.serviceId;
  const alertIds = new Set<string>();

  if (context.alertId) {
    const alert = await prisma.alert.findUnique({ where: { id: context.alertId } });
    if (alert) {
      projectId = projectId ?? alert.projectId;
      serviceId = serviceId ?? alert.serviceId ?? undefined;
      alertIds.add(alert.id);
    }
  }

  if (context.incidentId) {
    const incident = await prisma.incident.findUnique({
      where: { id: context.incidentId },
      include: { IncidentAlert: { include: { Alert: true } } }
    });
    if (incident) {
      projectId = projectId ?? incident.projectId;
      const firstServiceAlert = incident.IncidentAlert.find((row) => row.Alert.serviceId);
      serviceId = serviceId ?? firstServiceAlert?.Alert.serviceId ?? undefined;
      incident.IncidentAlert.forEach((row) => alertIds.add(row.Alert.id));
    }
  }

  if (alertIds.size === 0 && (projectId || serviceId)) {
    const rows = await prisma.alert.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        ...(serviceId ? { serviceId } : {})
      },
      select: { id: true },
      orderBy: { lastSeenAt: "desc" },
      take: 100
    });
    rows.forEach((row) => alertIds.add(row.id));
  }

  return { projectId, serviceId, alertIds: Array.from(alertIds) };
};

export const missingContext = (summary: string, missingFields?: string[]) => ({
  success: false,
  status: "MISSING_CONTEXT" as const,
  summary,
  ...(missingFields?.length ? { missingFields } : {})
});

export const misconfigured = (summary: string, missingEnvVars?: string[]) => ({
  success: false,
  status: "MISCONFIGURED_ENV" as const,
  summary,
  ...(missingEnvVars?.length ? { missingEnvVars } : {})
});

export const unsupported = (summary: string) => ({
  success: false,
  status: "UNSUPPORTED" as const,
  summary
});

export const completed = (summary: string, details?: Record<string, unknown>) => ({
  success: true,
  status: "COMPLETED" as const,
  summary,
  ...(details ? { details } : {})
});

export const failed = (summary: string, details?: Record<string, unknown>) => ({
  success: false,
  status: "FAILED" as const,
  summary,
  ...(details ? { details } : {})
});
