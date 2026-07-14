import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { recordObservation, recordOperationsTimelineEvent } from "./observation.service";
import { OBSERVATION_SOURCE, TIMELINE_EVENT } from "./intelligence-constants";

type JsonObject = Record<string, unknown>;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const asStringArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const items = value.filter((row): row is string => typeof row === "string");
  return items.length ? items : null;
};

/**
 * Upsert deployment intelligence from a ChangeEvent or webhook payload.
 * Correlates resulting incidents/alerts within a post-deploy window using real IDs only.
 */
export const upsertDeploymentRecord = async (input: {
  organizationId: string;
  projectId?: string | null;
  serviceId?: string | null;
  deployedAt: Date;
  summary: string;
  version?: string | null;
  commitSha?: string | null;
  branch?: string | null;
  changedServices?: string[] | null;
  changeEventId?: string | null;
  detailsJson?: JsonObject | null;
  source?: string;
  correlateWindowMinutes?: number;
}): Promise<{ id: string }> => {
  if (input.changeEventId) {
    const existing = await prisma.deploymentRecord.findFirst({
      where: {
        organizationId: input.organizationId,
        changeEventId: input.changeEventId
      }
    });
    if (existing) return { id: existing.id };
  }

  const windowMinutes = input.correlateWindowMinutes ?? 60;
  const windowEnd = new Date(input.deployedAt.getTime() + windowMinutes * 60_000);

  const [incidents, alerts] = await Promise.all([
    input.projectId
      ? prisma.incident.findMany({
          where: {
            projectId: input.projectId,
            openedAt: { gte: input.deployedAt, lte: windowEnd }
          },
          select: { id: true },
          take: 50
        })
      : Promise.resolve([]),
    input.projectId
      ? prisma.alert.findMany({
          where: {
            projectId: input.projectId,
            firstSeenAt: { gte: input.deployedAt, lte: windowEnd }
          },
          select: { id: true },
          take: 50
        })
      : Promise.resolve([])
  ]);

  const id = randomUUID();
  await prisma.deploymentRecord.create({
    data: {
      id,
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      serviceId: input.serviceId ?? null,
      deployedAt: input.deployedAt,
      version: input.version ?? null,
      commitSha: input.commitSha ?? null,
      branch: input.branch ?? null,
      changedServicesJson: input.changedServices ?? undefined,
      resultingIncidentIds: incidents.map((row) => row.id),
      resultingAlertIds: alerts.map((row) => row.id),
      recoveryEventIds: [],
      changeEventId: input.changeEventId ?? null,
      source: input.source ?? "CHANGE_EVENT",
      summary: input.summary,
      detailsJson: (input.detailsJson ?? undefined) as object | undefined
    }
  });

  await recordObservation({
    organizationId: input.organizationId,
    projectId: input.projectId,
    sourceType: OBSERVATION_SOURCE.DEPLOYMENT,
    sourceId: id,
    eventKey: "deployment.recorded",
    summary: input.summary,
    observedAt: input.deployedAt,
    payloadJson: {
      version: input.version ?? null,
      commitSha: input.commitSha ?? null,
      incidentCount: incidents.length,
      alertCount: alerts.length
    }
  });

  await recordOperationsTimelineEvent({
    organizationId: input.organizationId,
    projectId: input.projectId,
    eventType: TIMELINE_EVENT.DEPLOYMENT,
    summary: input.summary,
    sourceType: "DEPLOYMENT",
    sourceId: id,
    occurredAt: input.deployedAt,
    payloadJson: {
      version: input.version ?? null,
      commitSha: input.commitSha ?? null
    }
  });

  return { id };
};

/** Materialize deployment records from recent ChangeEvents that look like deploys. */
export const syncDeploymentsFromChangeEvents = async (
  organizationId: string,
  limit = 50
): Promise<number> => {
  const events = await prisma.changeEvent.findMany({
    where: {
      organizationId,
      OR: [
        { eventType: { contains: "DEPLOY", mode: "insensitive" } },
        { eventType: { contains: "RELEASE", mode: "insensitive" } },
        { summary: { contains: "deploy", mode: "insensitive" } }
      ]
    },
    orderBy: { occurredAt: "desc" },
    take: limit
  });

  let created = 0;
  for (const event of events) {
    const details =
      event.detailsJson && typeof event.detailsJson === "object"
        ? (event.detailsJson as JsonObject)
        : {};
    const result = await upsertDeploymentRecord({
      organizationId,
      projectId: event.projectId,
      serviceId: event.serviceId,
      deployedAt: event.occurredAt,
      summary: event.summary,
      version: asString(details.version) ?? asString(details.versionId),
      commitSha: asString(details.commit) ?? asString(details.commitSha) ?? asString(details.sha),
      branch: asString(details.branch),
      changedServices: asStringArray(details.changedServices),
      changeEventId: event.id,
      detailsJson: details,
      source: "CHANGE_EVENT"
    });
    if (result.id) created += 1;
  }
  return created;
};
