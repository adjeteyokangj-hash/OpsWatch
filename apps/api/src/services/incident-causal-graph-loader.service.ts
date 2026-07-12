import { prisma } from "../lib/prisma";
import type { IncidentCausalGraphResponse } from "../types/dto";
import { analyzeIncidentDeep } from "./ai/incident-analysis.service";
import { buildIncidentCausalGraphResponse } from "./incident-causal-graph.service";
import { listIncidentRootCauseCandidates } from "./incidents.service";
import { loadAnalysisContext } from "./remediation/remediation-suggest.service";
import { loadProjectTopology } from "./topology-loader.service";

export const loadIncidentCausalGraph = async (
  organizationId: string,
  incidentId: string
): Promise<IncidentCausalGraphResponse | null> => {
  const incident = await prisma.incident.findFirst({
    where: { id: incidentId, Project: { organizationId } },
    select: {
      id: true,
      projectId: true,
      title: true,
      status: true,
      severity: true,
      openedAt: true,
      correlationGroupId: true,
      IncidentAlert: {
        select: {
          Alert: { select: { serviceId: true } }
        }
      }
    }
  });
  if (!incident) return null;

  const [topology, context, candidates] = await Promise.all([
    loadProjectTopology(organizationId, incident.projectId),
    loadAnalysisContext(organizationId, incidentId),
    listIncidentRootCauseCandidates(organizationId, incidentId)
  ]);
  if (!topology || !context) return null;

  const diagnosis = await analyzeIncidentDeep(context);

  const windowStart = new Date(incident.openedAt.getTime() - 30 * 60_000);
  const windowEnd = new Date(incident.openedAt.getTime() + 15 * 60_000);
  const impactedServiceIds = incident.IncidentAlert.map((row) => row.Alert.serviceId).filter(
    (value): value is string => Boolean(value)
  );

  const changeEvents = await prisma.changeEvent.findMany({
    where: {
      organizationId,
      projectId: incident.projectId,
      occurredAt: { gte: windowStart, lte: windowEnd },
      ...(impactedServiceIds.length > 0
        ? { OR: [{ serviceId: { in: impactedServiceIds } }, { serviceId: null }] }
        : {})
    },
    orderBy: { occurredAt: "desc" },
    take: 20,
    select: {
      id: true,
      eventType: true,
      summary: true,
      occurredAt: true,
      serviceId: true,
      actor: true
    }
  });

  let correlatedIncidents: IncidentCausalGraphResponse["overlay"]["correlatedIncidents"] = [];
  if (incident.correlationGroupId) {
    const group = await prisma.organizationIncidentGroup.findFirst({
      where: { id: incident.correlationGroupId, organizationId },
      include: {
        Incidents: {
          where: { id: { not: incident.id } },
          include: {
            Project: { select: { id: true, name: true } },
            IncidentAlert: {
              select: { Alert: { select: { serviceId: true } } }
            }
          }
        }
      }
    });
    correlatedIncidents =
      group?.Incidents.map((row) => ({
        incidentId: row.id,
        projectId: row.projectId,
        projectName: row.Project.name,
        title: row.title,
        severity: row.severity,
        serviceIds: Array.from(
          new Set(
            row.IncidentAlert.map((ref) => ref.Alert.serviceId).filter((value): value is string => Boolean(value))
          )
        )
      })) ?? [];
  }

  return buildIncidentCausalGraphResponse({
    incident: {
      id: incident.id,
      projectId: incident.projectId,
      title: incident.title,
      status: incident.status,
      severity: incident.severity
    },
    topology,
    diagnosis,
    candidates: candidates ?? [],
    incidentServiceIds: impactedServiceIds,
    changeEvents,
    correlatedIncidents
  });
};
