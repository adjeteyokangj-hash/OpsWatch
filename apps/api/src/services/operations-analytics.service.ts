import { prisma } from "../lib/prisma";

const medianMinutes = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

const minutesBetween = (start: Date, end: Date): number =>
  Math.max(0, (end.getTime() - start.getTime()) / 60_000);

export type OperationsAnalyticsResponse = {
  windowDays: number;
  incidents: {
    opened: number;
    resolved: number;
    mttdMinutes: number | null;
    mttaMinutes: number | null;
    mttrMinutes: number | null;
  };
  automation: {
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    autonomousRuns: number;
    approvalPendingRuns: number;
    successRate: number | null;
  };
  playbooks: {
    activePlaybooks: number;
    approvedVersions: number;
    draftVersions: number;
    inReviewVersions: number;
  };
  correlation: {
    groupedIncidents: number;
    correlatedGroups: number;
    avgAlertsPerIncident: number | null;
  };
  maintenance: {
    activeWindows: number;
    scheduledWindows: number;
    suppressedAlerts: number;
  };
};

export const buildOperationsAnalytics = async (
  organizationId: string,
  windowDays = 30
): Promise<OperationsAnalyticsResponse> => {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const incidents = await prisma.incident.findMany({
    where: { Project: { organizationId }, openedAt: { gte: since } },
    select: {
      id: true,
      openedAt: true,
      acknowledgedAt: true,
      resolvedAt: true,
      correlationGroupId: true,
      IncidentAlert: { select: { alertId: true } }
    }
  });

  const mttdSamples: number[] = [];
  const mttaSamples: number[] = [];
  const mttrSamples: number[] = [];

  for (const incident of incidents) {
    if (incident.resolvedAt) {
      mttrSamples.push(minutesBetween(incident.openedAt, incident.resolvedAt));
    }
    if (incident.acknowledgedAt) {
      mttaSamples.push(minutesBetween(incident.openedAt, incident.acknowledgedAt));
    }
    mttdSamples.push(0);
  }

  const automationRuns = await prisma.automationRun.findMany({
    where: { organizationId, createdAt: { gte: since } },
    select: { status: true, executionMode: true }
  });

  const playbooks = await prisma.automationPlaybook.findMany({
    where: { isActive: true },
    include: { Versions: { select: { status: true } } }
  });

  const versionStatuses = playbooks.flatMap((row) => row.Versions.map((version) => version.status));

  const correlatedGroups = new Set(
    incidents.map((row) => row.correlationGroupId).filter((id): id is string => Boolean(id))
  );

  const alertCounts = incidents.map((row) => row.IncidentAlert.length);
  const avgAlerts =
    alertCounts.length > 0
      ? Math.round((alertCounts.reduce((sum, count) => sum + count, 0) / alertCounts.length) * 10) / 10
      : null;

  const maintenanceWindows = await prisma.maintenanceWindow.findMany({
    where: { organizationId },
    select: { status: true }
  });

  const suppressedAlerts = await prisma.alert.count({
    where: {
      maintenanceSuppressed: true,
      Project: { organizationId },
      firstSeenAt: { gte: since }
    }
  });

  const completedRuns = automationRuns.filter((row) => row.status === "COMPLETED").length;
  const failedRuns = automationRuns.filter((row) =>
    ["FAILED", "ROLLED_BACK", "REJECTED", "CANCELLED"].includes(row.status)
  ).length;

  return {
    windowDays,
    incidents: {
      opened: incidents.length,
      resolved: incidents.filter((row) => row.resolvedAt != null).length,
      mttdMinutes: medianMinutes(mttdSamples),
      mttaMinutes: medianMinutes(mttaSamples),
      mttrMinutes: medianMinutes(mttrSamples)
    },
    automation: {
      totalRuns: automationRuns.length,
      completedRuns,
      failedRuns,
      autonomousRuns: automationRuns.filter((row) => row.executionMode === "AUTONOMOUS").length,
      approvalPendingRuns: automationRuns.filter((row) => row.status === "APPROVAL_PENDING").length,
      successRate:
        automationRuns.length > 0
          ? Math.round((completedRuns / automationRuns.length) * 1000) / 10
          : null
    },
    playbooks: {
      activePlaybooks: playbooks.length,
      approvedVersions: versionStatuses.filter((status) => status === "APPROVED").length,
      draftVersions: versionStatuses.filter((status) => status === "DRAFT").length,
      inReviewVersions: versionStatuses.filter((status) => status === "IN_REVIEW").length
    },
    correlation: {
      groupedIncidents: incidents.filter((row) => row.correlationGroupId != null).length,
      correlatedGroups: correlatedGroups.size,
      avgAlertsPerIncident: avgAlerts
    },
    maintenance: {
      activeWindows: maintenanceWindows.filter((row) => row.status === "ACTIVE").length,
      scheduledWindows: maintenanceWindows.filter((row) => row.status === "SCHEDULED").length,
      suppressedAlerts
    }
  };
};

export const buildRemediationAccuracyReport = async (organizationId: string) => {
  const rows = await prisma.remediationLog.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 1000
  });

  const evaluated = rows.filter((row) => ["SUCCEEDED", "FAILED"].includes(row.status));
  const success = evaluated.filter((row) => row.status === "SUCCEEDED").length;
  const failed = evaluated.filter((row) => row.status === "FAILED").length;

  const byActionMap = new Map<
    string,
    {
      action: string;
      impactTier: string;
      total: number;
      success: number;
      overconfident: number;
      underconfident: number;
    }
  >();

  for (const row of evaluated) {
    const key = row.action;
    const bucket = byActionMap.get(key) ?? {
      action: row.action,
      impactTier: row.impactTier ?? "UNKNOWN",
      total: 0,
      success: 0,
      overconfident: 0,
      underconfident: 0
    };
    bucket.total += 1;
    if (row.status === "SUCCEEDED") bucket.success += 1;
    const predicted = row.predictedScore ?? 0;
    if (row.status === "FAILED" && predicted >= 70) bucket.overconfident += 1;
    if (row.status === "SUCCEEDED" && predicted > 0 && predicted < 50) bucket.underconfident += 1;
    byActionMap.set(key, bucket);
  }

  const byAction = [...byActionMap.values()].map((row) => ({
    action: row.action,
    impactTier: row.impactTier,
    total: row.total,
    successRate: row.total ? Math.round((row.success / row.total) * 1000) / 10 : 0,
    overconfidenceRate: row.total ? Math.round((row.overconfident / row.total) * 1000) / 10 : 0,
    underconfidenceCount: row.underconfident,
    suppressed: false
  }));

  const overconfidenceTotal = byAction.reduce((sum, row) => sum + row.overconfidenceRate * row.total, 0);
  const totalEvaluated = evaluated.length;

  return {
    overallAccuracy: totalEvaluated ? Math.round((success / totalEvaluated) * 1000) / 10 : 0,
    totalEvaluated,
    overconfidenceRate: totalEvaluated ? Math.round(overconfidenceTotal / totalEvaluated) / 10 : 0,
    byAction,
    total: rows.length,
    success,
    failed,
    accuracy: totalEvaluated ? Math.round((success / totalEvaluated) * 100) : 0
  };
};

export const buildAutoRunMetricsReport = async (organizationId: string) => {
  const rows = await prisma.remediationLog.findMany({
    where: { organizationId, executionMode: "AUTOMATIC" },
    orderBy: { createdAt: "desc" },
    take: 1000
  });

  const succeeded = rows.filter((row) => row.status === "SUCCEEDED").length;
  const failed = rows.filter((row) => row.status === "FAILED").length;
  const blockedByPolicy = rows.filter((row) =>
    String(row.resultJson ?? "").includes("policy")
  ).length;
  const blockedBySuppression = rows.filter((row) =>
    String(row.resultJson ?? "").includes("suppression")
  ).length;
  const blockedByConfidence = rows.filter((row) =>
    String(row.resultJson ?? "").includes("confidence")
  ).length;

  const byActionMap = new Map<string, { action: string; total: number; success: number; impactTier: string | null }>();
  for (const row of rows) {
    const bucket = byActionMap.get(row.action) ?? {
      action: row.action,
      total: 0,
      success: 0,
      impactTier: row.impactTier ?? null
    };
    bucket.total += 1;
    if (row.status === "SUCCEEDED") bucket.success += 1;
    byActionMap.set(row.action, bucket);
  }

  return {
    totalAutoRuns: rows.length,
    autoRunSuccessRate: rows.length ? Math.round((succeeded / rows.length) * 1000) / 10 : null,
    succeeded,
    failed,
    blockedByPolicy,
    blockedBySuppression,
    blockedByConfidence,
    byAction: [...byActionMap.values()].map((row) => ({
      action: row.action,
      total: row.total,
      successRate: row.total ? Math.round((row.success / row.total) * 1000) / 10 : null,
      impactTier: row.impactTier
    })),
    total: rows.length
  };
};
