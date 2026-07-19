import { AlertCategory, AlertSeverity, AlertStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { dispatchAlertNotifications } from "./notifications/notification.service";
import { findActiveMaintenanceForService } from "./maintenance-window-policy.service";
import { assessFlapping, buildAlertFingerprint } from "./alert-correlation.service";

export type CreateAlertResult = {
  alertId: string | null;
  created: boolean;
  suppressed: boolean;
};

const UNRESOLVED_STATUSES: AlertStatus[] = [
  AlertStatus.OPEN,
  AlertStatus.ACKNOWLEDGED,
  AlertStatus.REMEDIATING,
  AlertStatus.VERIFYING
];

/**
 * Resolve the canonical OperationalEntity for a legacy Service so that
 * newly created alerts carry a direct canonical reference instead of relying
 * on the reader's legacy-mapping fallback. Returns null when unmapped/ambiguous.
 */
const resolveCanonicalEntityId = async (input: {
  organizationId: string;
  projectId: string;
  serviceId?: string;
}): Promise<string | null> => {
  if (!input.serviceId) return null;
  const mappings = await prisma.legacyServiceEntityMapping.findMany({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      legacyServiceId: input.serviceId,
      status: "ACTIVE"
    },
    select: { entityId: true }
  });
  const entityIds = [...new Set(mappings.map((row) => row.entityId))];
  return entityIds.length === 1 ? entityIds[0]! : null;
};

export const createAlert = async (input: {
  projectId: string;
  serviceId?: string;
  sourceType: string;
  sourceId?: string;
  integrationId?: string;
  severity: AlertSeverity;
  category?: AlertCategory;
  title: string;
  message: string;
  dedupeBySourceId?: boolean;
}): Promise<CreateAlertResult> => {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { organizationId: true }
  });
  if (!project?.organizationId) {
    return { alertId: null, created: false, suppressed: false };
  }

  const operationalEntityId = await resolveCanonicalEntityId({
    organizationId: project.organizationId,
    projectId: input.projectId,
    serviceId: input.serviceId
  });

  const fingerprint = buildAlertFingerprint({
    projectId: input.projectId,
    serviceId: input.serviceId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    title: input.title
  });

  const maintenance = await findActiveMaintenanceForService({
    organizationId: project.organizationId,
    projectId: input.projectId,
    serviceId: input.serviceId
  });
  if (maintenance.inMaintenance && maintenance.suppressAlerts) {
    const suppressedId = randomUUID();
    await prisma.alert.create({
      data: {
        id: suppressedId,
        projectId: input.projectId,
        serviceId: input.serviceId,
        operationalEntityId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        integrationId: input.integrationId,
        severity: input.severity,
        category: input.category,
        title: input.title,
        message: `${input.message} [maintenance suppressed: ${maintenance.windowName ?? maintenance.windowId}]`,
        status: AlertStatus.RESOLVED,
        maintenanceSuppressed: true,
        maintenanceWindowId: maintenance.windowId ?? null,
        fingerprint,
        occurrenceCount: 1,
        resolvedAt: new Date()
      }
    });
    return { alertId: suppressedId, created: true, suppressed: true };
  }

  let alertToDispatchId: string | null = null;
  const dedupeBySourceId = input.dedupeBySourceId ?? true;

  const existingAlert = await prisma.alert.findFirst({
    where: {
      projectId: input.projectId,
      status: { in: UNRESOLVED_STATUSES },
      OR: [
        { fingerprint },
        {
          serviceId: input.serviceId ?? null,
          sourceType: input.sourceType,
          ...(dedupeBySourceId ? { sourceId: input.sourceId ?? null } : {}),
          title: input.title
        }
      ]
    },
    orderBy: { lastSeenAt: "desc" }
  });

  if (existingAlert) {
    const now = new Date();
    const occurrenceCount = (existingAlert.occurrenceCount ?? 1) + 1;
    const flapping = assessFlapping({
      occurrenceCount,
      firstSeenAt: existingAlert.firstSeenAt,
      lastSeenAt: now
    });
    const updatedAlert = await prisma.alert.update({
      where: { id: existingAlert.id },
      data: {
        severity: input.severity,
        ...(input.category ? { category: input.category } : {}),
        ...(input.integrationId ? { integrationId: input.integrationId } : {}),
        message: flapping.isFlapping
          ? `${input.message} [flapping: ${flapping.reason}]`
          : input.message,
        lastSeenAt: now,
        fingerprint: existingAlert.fingerprint ?? fingerprint,
        occurrenceCount,
        ...(existingAlert.operationalEntityId || !operationalEntityId
          ? {}
          : { operationalEntityId })
      }
    });
    if (updatedAlert.severity !== existingAlert.severity || flapping.isFlapping) {
      alertToDispatchId = updatedAlert.id;
    }
    if (alertToDispatchId) {
      await dispatchAlertNotifications(alertToDispatchId, "triggered");
    }
    return { alertId: updatedAlert.id, created: false, suppressed: false };
  }

  const createdAlert = await prisma.alert.create({
    data: {
      id: randomUUID(),
      projectId: input.projectId,
      serviceId: input.serviceId,
      operationalEntityId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      integrationId: input.integrationId,
      severity: input.severity,
      category: input.category,
      title: input.title,
      message: input.message,
      status: AlertStatus.OPEN,
      fingerprint,
      occurrenceCount: 1
    }
  });
  await dispatchAlertNotifications(createdAlert.id, "triggered");
  return { alertId: createdAlert.id, created: true, suppressed: false };
};

export const resolveAlertsBySourceType = async (
  projectId: string,
  sourceType: string,
  title?: string
): Promise<void> => {
  await prisma.alert.updateMany({
    where: {
      projectId,
      sourceType,
      status: { in: UNRESOLVED_STATUSES },
      ...(title ? { title } : {})
    },
    data: {
      status: AlertStatus.RESOLVED,
      resolvedAt: new Date(),
      lastSeenAt: new Date()
    }
  });
};

export const resolveAlertsBySourceId = async (
  projectId: string,
  sourceType: string,
  sourceId: string
): Promise<number> => {
  const result = await prisma.alert.updateMany({
    where: {
      projectId,
      sourceType,
      sourceId,
      status: { in: UNRESOLVED_STATUSES }
    },
    data: {
      status: AlertStatus.RESOLVED,
      resolvedAt: new Date(),
      lastSeenAt: new Date()
    }
  });
  return result.count;
};
