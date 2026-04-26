import { AlertCategory, EventType, IntegrationType } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { createAlert } from "./alerting.service";

const severityForEvent = (type: EventType): "MEDIUM" | "HIGH" | "CRITICAL" => {
  switch (type) {
    case "SERVICE_DOWN":
    case "HEARTBEAT_MISSED":
    case "PAYMENT_FAILED":
    case "WEBHOOK_FAILED":
    case "DEPLOY_FAILED":
      return "HIGH";
    case "AUTH_FAILURE_SPIKE":
    case "TRAFFIC_SPIKE":
    case "AUTH_SPIKE":
      return "CRITICAL";
    case "SSL_EXPIRING":
    case "DOMAIN_EXPIRING":
      return "HIGH";
    case "EMAIL_FAILED":
    case "GOOGLE_API_FAILED":
    default:
      return "MEDIUM";
  }
};

const categoryForEvent = (type: EventType): AlertCategory => {
  switch (type) {
    case "SERVICE_DOWN":
    case "HEARTBEAT_MISSED":
      return "AVAILABILITY";
    case "PAYMENT_FAILED":
    case "WEBHOOK_FAILED":
    case "EMAIL_FAILED":
    case "CRON_MISSED":
    case "GOOGLE_API_FAILED":
    case "BOOKING_FAILED":
      return "RELIABILITY";
    case "AUTH_SPIKE":
    case "AUTH_FAILURE_SPIKE":
    case "TRAFFIC_SPIKE":
    case "WEBHOOK_SIGNATURE_FAILED":
      return "SECURITY";
    case "DEPLOYMENT_STARTED":
    case "DEPLOYMENT_FINISHED":
    case "DEPLOY_FAILED":
    case "SSL_EXPIRING":
    case "DOMAIN_EXPIRING":
      return "DEPENDENCY_CHANGE";
    default:
      return "RELIABILITY";
  }
};

const SPIKE_WINDOW_MINUTES = Number(process.env.EVENT_SPIKE_WINDOW_MINUTES || 5);
const AUTH_FAILURE_SPIKE_THRESHOLD = Number(process.env.AUTH_FAILURE_SPIKE_THRESHOLD || 10);
const TRAFFIC_SPIKE_THRESHOLD = Number(process.env.TRAFFIC_SPIKE_THRESHOLD || 50);

const shouldAlertForSpike = async (input: {
  projectId: string;
  serviceId?: string;
  type: EventType;
}): Promise<{ emit: boolean; count: number; threshold: number }> => {
  const isSpikeType = input.type === "AUTH_FAILURE_SPIKE" || input.type === "TRAFFIC_SPIKE";
  if (!isSpikeType) {
    return { emit: true, count: 1, threshold: 1 };
  }

  const threshold = input.type === "AUTH_FAILURE_SPIKE" ? AUTH_FAILURE_SPIKE_THRESHOLD : TRAFFIC_SPIKE_THRESHOLD;
  const since = new Date(Date.now() - SPIKE_WINDOW_MINUTES * 60_000);
  const count = await prisma.event.count({
    where: {
      projectId: input.projectId,
      ...(input.serviceId ? { serviceId: input.serviceId } : {}),
      type: input.type,
      createdAt: { gte: since }
    }
  });

  return { emit: count >= threshold, count, threshold };
};

const integrationTypeForEvent = (type: EventType): IntegrationType | undefined => {
  switch (type) {
    case "WEBHOOK_FAILED":
      return "WEBHOOK";
    case "EMAIL_FAILED":
      return "EMAIL";
    case "PAYMENT_FAILED":
      return "STRIPE";
    default:
      return undefined;
  }
};

const resolveIntegrationId = async (
  projectId: string,
  type: EventType,
  explicitIntegrationId?: string
): Promise<string | undefined> => {
  if (explicitIntegrationId) {
    return explicitIntegrationId;
  }

  const integrationType = integrationTypeForEvent(type);
  if (!integrationType) {
    return undefined;
  }

  const integration = await prisma.projectIntegration.upsert({
    where: {
      projectId_type: {
        projectId,
        type: integrationType
      }
    },
    update: {},
    create: {
      id: randomUUID(),
      projectId,
      type: integrationType,
      enabled: false,
      name: `Auto-discovered ${integrationType.toLowerCase()} integration`,
      updatedAt: new Date()
    },
    select: { id: true }
  });

  return integration?.id;
};

export const ingestEvent = async (projectId: string, body: any): Promise<void> => {
  const event = await prisma.event.create({
    data: {
      id: randomUUID(),
      projectId,
      serviceId: body.serviceId,
      type: body.type,
      severity: body.severity,
      source: body.source,
      message: body.message,
      fingerprint: body.fingerprint,
      payloadJson: body.payload
    }
  });

  const type = body.type as EventType;
  const spikeDecision = await shouldAlertForSpike({
    projectId,
    serviceId: body.serviceId,
    type
  });

  if (!spikeDecision.emit) {
    return;
  }

  const integrationId = await resolveIntegrationId(
    projectId,
    type,
    body.integrationId ?? body.payload?.integrationId
  );

  await createAlert({
    projectId,
    serviceId: body.serviceId,
    sourceType: "EVENT",
    sourceId: event.id,
    integrationId,
    severity: severityForEvent(type),
    category: categoryForEvent(type),
    title: body.type,
    message:
      type === "AUTH_FAILURE_SPIKE" || type === "TRAFFIC_SPIKE"
        ? `${body.message} (count ${spikeDecision.count} in ${SPIKE_WINDOW_MINUTES}m; threshold ${spikeDecision.threshold})`
        : body.message,
    // For spike-style alerts we want one open alert per title/service, not one per event id.
    dedupeBySourceId: !(type === "AUTH_FAILURE_SPIKE" || type === "TRAFFIC_SPIKE")
  });
};
