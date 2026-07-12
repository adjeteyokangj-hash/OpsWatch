import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";

/**
 * Retention feature keys. Domain-scoped keys are canonical; legacy flat keys are
 * still accepted so the worker keeps working during/after the entitlement rename.
 */
export const TELEMETRY_RETENTION_KEYS = ["retention.telemetry.days", "telemetry.retention_days"];
export const INCIDENT_RETENTION_KEYS = ["retention.incidents.days", "incidents.retention_days"];

/** Hard safety floor: never prune data newer than this, even on misconfiguration. */
export const MIN_RETENTION_DAYS = 1;

export type RetentionPolicy = {
  organizationId: string;
  telemetryDays: number | null;
  incidentDays: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const computeCutoff = (now: Date, retentionDays: number | null): Date | null => {
  if (retentionDays == null) return null;
  const days = Math.max(MIN_RETENTION_DAYS, Math.floor(retentionDays));
  return new Date(now.getTime() - days * DAY_MS);
};

export const resolveRetentionFromEntitlements = (
  entitlements: Array<{ featureKey: string; retentionDays: number | null; enabled: boolean }>
): { telemetryDays: number | null; incidentDays: number | null } => {
  const pick = (keys: string[]): number | null => {
    const row = entitlements.find((entry) => keys.includes(entry.featureKey) && entry.enabled);
    return row?.retentionDays ?? null;
  };

  return {
    telemetryDays: pick(TELEMETRY_RETENTION_KEYS),
    incidentDays: pick(INCIDENT_RETENTION_KEYS)
  };
};

export const loadRetentionPolicies = async (): Promise<RetentionPolicy[]> => {
  const subscriptions = await prisma.subscription.findMany({
    where: { status: { in: ["ACTIVE", "TRIAL", "PAST_DUE"] } },
    include: { Plan: { include: { PlanEntitlement: true } } }
  });

  return subscriptions.map((subscription) => {
    const { telemetryDays, incidentDays } = resolveRetentionFromEntitlements(
      subscription.Plan.PlanEntitlement
    );
    return {
      organizationId: subscription.organizationId,
      telemetryDays,
      incidentDays
    };
  });
};

export const pruneTelemetryForOrg = async (
  organizationId: string,
  cutoff: Date
): Promise<{ checkResults: number; events: number; heartbeats: number }> => {
  const [checkResults, events, heartbeats] = await prisma.$transaction([
    prisma.checkResult.deleteMany({
      where: { checkedAt: { lt: cutoff }, Check: { Service: { Project: { organizationId } } } }
    }),
    prisma.event.deleteMany({
      where: { createdAt: { lt: cutoff }, Project: { organizationId } }
    }),
    prisma.heartbeat.deleteMany({
      where: { receivedAt: { lt: cutoff }, Project: { organizationId } }
    })
  ]);

  return {
    checkResults: checkResults.count,
    events: events.count,
    heartbeats: heartbeats.count
  };
};

export const pruneIncidentsForOrg = async (
  organizationId: string,
  cutoff: Date
): Promise<{ incidents: number; alerts: number }> => {
  // Resolved incidents cascade-delete their timeline events and alert links.
  const incidents = await prisma.incident.deleteMany({
    where: {
      status: "RESOLVED",
      resolvedAt: { lt: cutoff },
      Project: { organizationId }
    }
  });

  const alerts = await prisma.alert.deleteMany({
    where: {
      status: "RESOLVED",
      resolvedAt: { lt: cutoff },
      Project: { organizationId }
    }
  });

  return { incidents: incidents.count, alerts: alerts.count };
};

export type RetentionSweepSummary = {
  organizationsScanned: number;
  checkResultsDeleted: number;
  eventsDeleted: number;
  heartbeatsDeleted: number;
  incidentsDeleted: number;
  alertsDeleted: number;
};

export const runRetentionSweep = async (now = new Date()): Promise<RetentionSweepSummary> => {
  const policies = await loadRetentionPolicies();
  const summary: RetentionSweepSummary = {
    organizationsScanned: policies.length,
    checkResultsDeleted: 0,
    eventsDeleted: 0,
    heartbeatsDeleted: 0,
    incidentsDeleted: 0,
    alertsDeleted: 0
  };

  for (const policy of policies) {
    const telemetryCutoff = computeCutoff(now, policy.telemetryDays);
    if (telemetryCutoff) {
      const result = await pruneTelemetryForOrg(policy.organizationId, telemetryCutoff);
      summary.checkResultsDeleted += result.checkResults;
      summary.eventsDeleted += result.events;
      summary.heartbeatsDeleted += result.heartbeats;
    }

    const incidentCutoff = computeCutoff(now, policy.incidentDays);
    if (incidentCutoff) {
      const result = await pruneIncidentsForOrg(policy.organizationId, incidentCutoff);
      summary.incidentsDeleted += result.incidents;
      summary.alertsDeleted += result.alerts;
    }
  }

  logger.info(
    `Retention sweep complete: scanned ${summary.organizationsScanned} org(s), ` +
      `deleted ${summary.checkResultsDeleted} check result(s), ${summary.eventsDeleted} event(s), ` +
      `${summary.heartbeatsDeleted} heartbeat(s), ${summary.incidentsDeleted} incident(s), ` +
      `${summary.alertsDeleted} alert(s)`
  );

  return summary;
};
