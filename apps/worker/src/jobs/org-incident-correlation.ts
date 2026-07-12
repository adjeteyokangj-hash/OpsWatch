import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";

const INFRA_SIGNATURES = [
  "redis",
  "postgresql",
  "postgres",
  "database",
  "queue",
  "webhook",
  "smtp",
  "email"
] as const;

export const extractCorrelationKey = (input: {
  alertTitles: string[];
  alertMessages: string[];
  serviceNames: string[];
}): string | null => {
  const haystack = [...input.alertTitles, ...input.alertMessages, ...input.serviceNames]
    .join(" ")
    .toLowerCase();

  for (const signature of INFRA_SIGNATURES) {
    if (haystack.includes(signature)) {
      return `infra:${signature}`;
    }
  }

  const sharedService = input.serviceNames.find((name) => name.trim().length > 2);
  if (sharedService) {
    return `service:${sharedService.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  }

  return null;
};

export const correlateOrganizationIncidents = async (): Promise<number> => {
  const cutoff = new Date(Date.now() - 30 * 60_000);
  const openIncidents = await prisma.incident.findMany({
    where: {
      status: { in: ["OPEN", "INVESTIGATING", "MONITORING"] },
      openedAt: { gte: cutoff },
      correlationGroupId: null
    },
    include: {
      Project: { select: { organizationId: true, name: true } },
      IncidentAlert: {
        include: {
          Alert: {
            select: {
              title: true,
              message: true,
              Service: { select: { name: true } }
            }
          }
        }
      }
    }
  });

  const buckets = new Map<string, typeof openIncidents>();

  for (const incident of openIncidents) {
    const orgId = incident.Project.organizationId;
    if (!orgId) continue;

    const key = extractCorrelationKey({
      alertTitles: incident.IncidentAlert.map((row) => row.Alert.title),
      alertMessages: incident.IncidentAlert.map((row) => row.Alert.message),
      serviceNames: incident.IncidentAlert.map((row) => row.Alert.Service?.name ?? "").filter(Boolean)
    });
    if (!key) continue;

    const bucketKey = `${orgId}:${key}`;
    const existing = buckets.get(bucketKey) ?? [];
    existing.push(incident);
    buckets.set(bucketKey, existing);
  }

  let groupsCreated = 0;

  for (const [, incidents] of buckets) {
    const projectIds = new Set(incidents.map((row) => row.projectId));
    if (projectIds.size < 2) continue;

    const orgId = incidents[0]!.Project.organizationId!;
    const correlationKey =
      extractCorrelationKey({
        alertTitles: incidents.flatMap((row) => row.IncidentAlert.map((ref) => ref.Alert.title)),
        alertMessages: incidents.flatMap((row) => row.IncidentAlert.map((ref) => ref.Alert.message)),
        serviceNames: incidents.flatMap((row) =>
          row.IncidentAlert.map((ref) => ref.Alert.Service?.name ?? "").filter(Boolean)
        )
      }) ?? `multi-project:${randomUUID()}`;

    const primary = [...incidents].sort(
      (a, b) =>
        ({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 }[b.severity] ?? 0) -
        ({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 }[a.severity] ?? 0)
    )[0]!;

    const groupId = randomUUID();
    await prisma.organizationIncidentGroup.create({
      data: {
        id: groupId,
        organizationId: orgId,
        correlationKey,
        rootCauseSummary: `Shared upstream failure detected across ${projectIds.size} applications.`,
        primaryIncidentId: primary.id,
        updatedAt: new Date()
      }
    });

    await prisma.incident.updateMany({
      where: { id: { in: incidents.map((row) => row.id) } },
      data: { correlationGroupId: groupId }
    });

    for (const incident of incidents) {
      await prisma.incidentTimelineEvent.create({
        data: {
          id: randomUUID(),
          incidentId: incident.id,
          projectId: incident.projectId,
          eventType: "ORG_CORRELATION",
          summary: `Linked to organization-wide incident group (${projectIds.size} applications affected).`,
          sourceType: "ORGANIZATION_INCIDENT_GROUP",
          sourceId: groupId,
          payloadJson: {
            correlationKey,
            primaryIncidentId: primary.id,
            relatedProjectCount: projectIds.size
          }
        }
      });
    }

    groupsCreated += 1;
  }

  return groupsCreated;
};
