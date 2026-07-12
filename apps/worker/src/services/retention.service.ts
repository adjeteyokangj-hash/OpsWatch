import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";

export const TELEMETRY_RETENTION_KEYS = ["retention.telemetry.days", "telemetry.retention_days"];
export const INCIDENT_RETENTION_KEYS = ["retention.incidents.days", "incidents.retention_days"];
export const INCIDENT_MEMORY_RETENTION_KEYS = [
  "retention.incident_memory.days",
  "incident_memory.retention_days"
];

export const MIN_RETENTION_DAYS = 1;
export const DEFAULT_BATCH_SIZE = 500;
export const DEFAULT_MAX_ROWS_PER_TABLE = 5000;
export const DEFAULT_TRANSACTION_TIMEOUT_MS = 30_000;

export type RetentionPolicy = {
  organizationId: string;
  telemetryDays: number | null;
  incidentDays: number | null;
  incidentMemoryDays: number | null;
};

export type RetentionRunOptions = {
  dryRun?: boolean;
  batchSize?: number;
  maxRowsPerTable?: number;
  transactionTimeoutMs?: number;
  now?: Date;
};

export type OrgRetentionLog = {
  organizationId: string;
  telemetry: { checkResults: number; events: number; heartbeats: number };
  incidents: { incidents: number; alerts: number };
  incidentMemory: number;
  skipped?: string;
};

export type RetentionSweepSummary = {
  organizationsScanned: number;
  organizationsSkipped: number;
  dryRun: boolean;
  checkResultsDeleted: number;
  eventsDeleted: number;
  heartbeatsDeleted: number;
  incidentsDeleted: number;
  alertsDeleted: number;
  incidentMemoryDeleted: number;
  organizationLogs: OrgRetentionLog[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const computeCutoff = (now: Date, retentionDays: number | null): Date | null => {
  if (retentionDays == null) return null;
  const days = Math.max(MIN_RETENTION_DAYS, Math.floor(retentionDays));
  return new Date(now.getTime() - days * DAY_MS);
};

export const resolveRetentionFromEntitlements = (
  entitlements: Array<{ featureKey: string; retentionDays: number | null; enabled: boolean }>
): Pick<RetentionPolicy, "telemetryDays" | "incidentDays" | "incidentMemoryDays"> => {
  const pick = (keys: string[]): number | null => {
    const row = entitlements.find((entry) => keys.includes(entry.featureKey) && entry.enabled);
    return row?.retentionDays ?? null;
  };

  return {
    telemetryDays: pick(TELEMETRY_RETENTION_KEYS),
    incidentDays: pick(INCIDENT_RETENTION_KEYS),
    incidentMemoryDays: pick(INCIDENT_MEMORY_RETENTION_KEYS)
  };
};

export const loadRetentionPolicies = async (): Promise<RetentionPolicy[]> => {
  const subscriptions = await prisma.subscription.findMany({
    where: { status: { in: ["ACTIVE", "TRIAL", "PAST_DUE"] } },
    include: { Plan: { include: { PlanEntitlement: true } } }
  });

  return subscriptions.map((subscription) => {
    const resolved = resolveRetentionFromEntitlements(subscription.Plan.PlanEntitlement);
    return {
      organizationId: subscription.organizationId,
      ...resolved
    };
  });
};

const deleteBatch = async (
  fetchIds: () => Promise<string[]>,
  deleteIds: (ids: string[]) => Promise<number>,
  options: Required<Pick<RetentionRunOptions, "batchSize" | "maxRowsPerTable">>,
  dryRun: boolean
): Promise<number> => {
  let total = 0;
  while (total < options.maxRowsPerTable) {
    const ids = await fetchIds();
    if (ids.length === 0) break;
    const slice = ids.slice(0, Math.min(options.batchSize, options.maxRowsPerTable - total));
    if (!dryRun) {
      await deleteIds(slice);
    }
    total += slice.length;
    if (slice.length < options.batchSize) break;
  }
  return total;
};

export const pruneTelemetryForOrg = async (
  organizationId: string,
  cutoff: Date,
  options: RetentionRunOptions = {}
): Promise<{ checkResults: number; events: number; heartbeats: number }> => {
  const dryRun = options.dryRun ?? false;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxRowsPerTable = options.maxRowsPerTable ?? DEFAULT_MAX_ROWS_PER_TABLE;

  const runTable = async (
    fetchIds: () => Promise<string[]>,
    deleteIds: (ids: string[]) => Promise<number>
  ) =>
    deleteBatch(fetchIds, deleteIds, { batchSize, maxRowsPerTable }, dryRun);

  const checkResults = await runTable(
    () =>
      prisma.checkResult
        .findMany({
          where: { checkedAt: { lt: cutoff }, Check: { Service: { Project: { organizationId } } } },
          select: { id: true },
          take: batchSize
        })
        .then((rows) => rows.map((row) => row.id)),
    (ids) => prisma.checkResult.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count)
  );

  const events = await runTable(
    () =>
      prisma.event
        .findMany({
          where: { createdAt: { lt: cutoff }, Project: { organizationId } },
          select: { id: true },
          take: batchSize
        })
        .then((rows) => rows.map((row) => row.id)),
    (ids) => prisma.event.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count)
  );

  const heartbeats = await runTable(
    () =>
      prisma.heartbeat
        .findMany({
          where: { receivedAt: { lt: cutoff }, Project: { organizationId } },
          select: { id: true },
          take: batchSize
        })
        .then((rows) => rows.map((row) => row.id)),
    (ids) => prisma.heartbeat.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count)
  );

  return { checkResults, events, heartbeats };
};

export const pruneIncidentsForOrg = async (
  organizationId: string,
  cutoff: Date,
  options: RetentionRunOptions = {}
): Promise<{ incidents: number; alerts: number }> => {
  const dryRun = options.dryRun ?? false;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxRowsPerTable = options.maxRowsPerTable ?? DEFAULT_MAX_ROWS_PER_TABLE;

  const incidents = await deleteBatch(
    () =>
      prisma.incident
        .findMany({
          where: {
            status: "RESOLVED",
            resolvedAt: { lt: cutoff },
            Project: { organizationId }
          },
          select: { id: true },
          take: batchSize
        })
        .then((rows) => rows.map((row) => row.id)),
    (ids) => prisma.incident.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count),
    { batchSize, maxRowsPerTable },
    dryRun
  );

  const alerts = await deleteBatch(
    () =>
      prisma.alert
        .findMany({
          where: {
            status: "RESOLVED",
            resolvedAt: { lt: cutoff },
            Project: { organizationId }
          },
          select: { id: true },
          take: batchSize
        })
        .then((rows) => rows.map((row) => row.id)),
    (ids) => prisma.alert.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count),
    { batchSize, maxRowsPerTable },
    dryRun
  );

  return { incidents, alerts };
};

export const pruneIncidentMemoryForOrg = async (
  organizationId: string,
  cutoff: Date,
  options: RetentionRunOptions = {}
): Promise<number> =>
  deleteBatch(
    () =>
      prisma.incidentMemoryEntry
        .findMany({
          where: {
            organizationId,
            OR: [{ resolvedAt: { lt: cutoff } }, { resolvedAt: null, createdAt: { lt: cutoff } }]
          },
          select: { id: true },
          take: options.batchSize ?? DEFAULT_BATCH_SIZE
        })
        .then((rows) => rows.map((row) => row.id)),
    (ids) => prisma.incidentMemoryEntry.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count),
    {
      batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
      maxRowsPerTable: options.maxRowsPerTable ?? DEFAULT_MAX_ROWS_PER_TABLE
    },
    options.dryRun ?? false
  );

export const runRetentionSweep = async (
  options: RetentionRunOptions = {}
): Promise<RetentionSweepSummary> => {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? process.env.WORKER_RETENTION_DRY_RUN === "true";

  let policies: RetentionPolicy[] = [];
  try {
    policies = await loadRetentionPolicies();
  } catch (error) {
    logger.error("Retention policy resolution failed", { error: String(error) });
    throw error;
  }

  const summary: RetentionSweepSummary = {
    organizationsScanned: policies.length,
    organizationsSkipped: 0,
    dryRun,
    checkResultsDeleted: 0,
    eventsDeleted: 0,
    heartbeatsDeleted: 0,
    incidentsDeleted: 0,
    alertsDeleted: 0,
    incidentMemoryDeleted: 0,
    organizationLogs: []
  };

  for (const policy of policies) {
    const orgLog: OrgRetentionLog = {
      organizationId: policy.organizationId,
      telemetry: { checkResults: 0, events: 0, heartbeats: 0 },
      incidents: { incidents: 0, alerts: 0 },
      incidentMemory: 0
    };

    try {
      const telemetryCutoff = computeCutoff(now, policy.telemetryDays);
      if (telemetryCutoff) {
        const result = await pruneTelemetryForOrg(policy.organizationId, telemetryCutoff, {
          ...options,
          dryRun
        });
        orgLog.telemetry = result;
        summary.checkResultsDeleted += result.checkResults;
        summary.eventsDeleted += result.events;
        summary.heartbeatsDeleted += result.heartbeats;
      }

      const incidentCutoff = computeCutoff(now, policy.incidentDays);
      if (incidentCutoff) {
        const result = await pruneIncidentsForOrg(policy.organizationId, incidentCutoff, {
          ...options,
          dryRun
        });
        orgLog.incidents = result;
        summary.incidentsDeleted += result.incidents;
        summary.alertsDeleted += result.alerts;
      }

      const memoryCutoff = computeCutoff(now, policy.incidentMemoryDays);
      if (memoryCutoff) {
        const deleted = await pruneIncidentMemoryForOrg(policy.organizationId, memoryCutoff, {
          ...options,
          dryRun
        });
        orgLog.incidentMemory = deleted;
        summary.incidentMemoryDeleted += deleted;
      }
    } catch (error) {
      summary.organizationsSkipped += 1;
      orgLog.skipped = error instanceof Error ? error.message : String(error);
      logger.warn(`Retention sweep skipped org ${policy.organizationId}`, { error: orgLog.skipped });
    }

    summary.organizationLogs.push(orgLog);
    logger.info(
      `Retention ${dryRun ? "dry-run" : "sweep"} org ${policy.organizationId}: ` +
        `${orgLog.telemetry.checkResults} check results, ${orgLog.telemetry.events} events, ` +
        `${orgLog.telemetry.heartbeats} heartbeats, ${orgLog.incidents.incidents} incidents, ` +
        `${orgLog.incidents.alerts} alerts, ${orgLog.incidentMemory} memory entries` +
        (orgLog.skipped ? ` (skipped: ${orgLog.skipped})` : "")
    );
  }

  logger.info(
    `Retention ${dryRun ? "dry-run" : "sweep"} complete: scanned ${summary.organizationsScanned} org(s), ` +
      `skipped ${summary.organizationsSkipped}, deleted ${summary.checkResultsDeleted} check result(s), ` +
      `${summary.eventsDeleted} event(s), ${summary.heartbeatsDeleted} heartbeat(s), ` +
      `${summary.incidentsDeleted} incident(s), ${summary.alertsDeleted} alert(s), ` +
      `${summary.incidentMemoryDeleted} memory entries`
  );

  return summary;
};
