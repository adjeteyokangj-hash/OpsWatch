import { randomUUID } from "crypto";
import type { BillingPlanType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { loadLatestCheckResultsByCheckIds } from "./check-result-batch.service";
import { computeProjectHealth } from "./project-health.service";
import { createDefaultProjectBilling, getProjectBilling, normalizeAllowanceLimit, resolvePricingLabel } from "./project-billing.service";
import { listActiveMaintenanceWindows } from "./maintenance-window-policy.service";
import { hasActiveVerificationRun } from "./project-recovery-lifecycle.service";

type ProjectConnectionSignal = {
  id: string;
  name: string;
  mode: string;
  health: string;
  healthReason: string | null;
  installationStatus: string;
  lastSuccessAt: Date | null;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  syncIntervalMinutes: number | null;
};

type ProjectHeartbeatSignal = {
  receivedAt: Date;
  status: string;
  message: string | null;
};

type ProjectRow = {
  id: string;
  organizationId: string | null;
  status: any;
  healthReason: string | null;
  monitoringEnabled: boolean;
  isActive: boolean;
  Service: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    criticality: string;
    Check: Array<{
      id: string;
      isActive: boolean;
      CheckResult: Array<{
        status: string;
        checkedAt: Date;
        responseCode?: number | null;
        responseTimeMs?: number | null;
        message?: string | null;
      }>;
    }>;
    OutgoingDependencies?: Array<{ id: string }>;
  }>;
  Alert: Array<{ serviceId: string | null; severity: string; status: string }>;
  Incident: Array<{ status: string; serviceId?: string | null }>;
  Heartbeat: ProjectHeartbeatSignal[];
  Connection?: ProjectConnectionSignal[];
  ProjectBilling?: {
    plan: BillingPlanType;
    monthlyPrice: number;
    currency: string;
    billingStatus: string;
    dataRetentionDays: number;
    checkLimit: number | null;
    userLimit: number | null;
    automationRunLimit: number | null;
  } | null;
};

export type InheritedModuleSignal = {
  status: "HEALTHY" | "DEGRADED" | "DOWN" | "PAUSED";
  displayLabel: string;
  reason: string;
  source: "HEARTBEAT" | "CONNECTION_DISCOVERY";
  observedAt: Date;
};

const heartbeatStatus = (status: string): InheritedModuleSignal["status"] => {
  if (status === "DOWN") return "DOWN";
  if (status === "DEGRADED") return "DEGRADED";
  if (status === "PAUSED") return "PAUSED";
  return "HEALTHY";
};

const heartbeatLabel = (status: InheritedModuleSignal["status"]): string => {
  if (status === "DOWN") return "App heartbeat down";
  if (status === "DEGRADED") return "App heartbeat delayed";
  if (status === "PAUSED") return "Monitoring paused";
  return "App heartbeat active";
};

const latestDate = (...values: Array<Date | null | undefined>): Date | null => {
  let latest: Date | null = null;
  for (const value of values) {
    if (!(value instanceof Date)) continue;
    if (!latest || value.getTime() > latest.getTime()) latest = value;
  }
  return latest;
};

/**
 * Logical modules discovered from an authenticated API connection do not each
 * need a separate push heartbeat. A fresh application heartbeat takes priority;
 * otherwise the latest authenticated API discovery result is the live signal.
 */
export const resolveInheritedModuleSignal = (
  row: Pick<ProjectRow, "Heartbeat" | "Connection">,
  now: Date = new Date()
): InheritedModuleSignal | null => {
  const latestHeartbeat = row.Heartbeat?.[0] ?? null;
  let staleHeartbeat: InheritedModuleSignal | null = null;

  if (latestHeartbeat?.receivedAt) {
    const ageMinutes = Math.max(0, now.getTime() - latestHeartbeat.receivedAt.getTime()) / 60_000;
    const status = heartbeatStatus(latestHeartbeat.status);

    if (ageMinutes < 10) {
      return {
        status,
        displayLabel: heartbeatLabel(status),
        reason:
          latestHeartbeat.message ||
          `Application heartbeat reported ${latestHeartbeat.status.toLowerCase()}.`,
        source: "HEARTBEAT",
        observedAt: latestHeartbeat.receivedAt
      };
    }

    staleHeartbeat = {
      status: "DEGRADED",
      displayLabel: "App heartbeat delayed",
      reason: `The last application heartbeat is ${Math.floor(ageMinutes)} minutes old.`,
      source: "HEARTBEAT",
      observedAt: latestHeartbeat.receivedAt
    };
  }

  const candidates: InheritedModuleSignal[] = [];
  for (const connection of row.Connection ?? []) {
    if (connection.mode !== "API") continue;
    if (connection.installationStatus !== "CONNECTED") continue;

    const observedAt = latestDate(connection.lastSuccessAt, connection.lastSyncAt);
    if (!observedAt) continue;

    const ageMinutes = Math.max(0, now.getTime() - observedAt.getTime()) / 60_000;
    const freshnessWindowMinutes = Math.max(20, (connection.syncIntervalMinutes ?? 15) * 3);
    const failed =
      connection.lastSyncStatus === "FAILED" ||
      ["UNHEALTHY", "FAILED", "DEGRADED", "DOWN"].includes(connection.health);
    const succeeded =
      !failed && (connection.health === "HEALTHY" || connection.lastSyncStatus === "SUCCEEDED");

    if (failed) {
      candidates.push({
        status: "DEGRADED",
        displayLabel: "Connection needs attention",
        reason:
          connection.healthReason ||
          `The latest ${connection.name} connection check failed.`,
        source: "CONNECTION_DISCOVERY",
        observedAt
      });
      continue;
    }

    if (succeeded && ageMinutes <= freshnessWindowMinutes) {
      candidates.push({
        status: "HEALTHY",
        displayLabel: "Connection verified",
        reason:
          connection.healthReason ||
          `Authenticated ${connection.name} connection responded successfully.`,
        source: "CONNECTION_DISCOVERY",
        observedAt
      });
      continue;
    }

    if (succeeded) {
      candidates.push({
        status: "DEGRADED",
        displayLabel: "Connection check overdue",
        reason: `The last successful ${connection.name} connection check is ${Math.floor(ageMinutes)} minutes old.`,
        source: "CONNECTION_DISCOVERY",
        observedAt
      });
    }
  }

  candidates.sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
  return candidates[0] ?? staleHeartbeat;
};

const attachLatestCheckResults = async <
  T extends {
    Service: Array<{
      Check: Array<{ id: string; isActive: boolean; CheckResult?: Array<unknown> }>;
    }>;
  }
>(
  row: T
): Promise<T> => {
  const checkIds = row.Service.flatMap((service) => service.Check.map((check) => check.id));
  const latestByCheckId = await loadLatestCheckResultsByCheckIds(checkIds);

  return {
    ...row,
    Service: row.Service.map((service) => ({
      ...service,
      Check: service.Check.map((check) => {
        const latest = latestByCheckId.get(check.id);
        return {
          ...check,
          CheckResult: latest
            ? [
                {
                  status: latest.status,
                  checkedAt: latest.checkedAt,
                  responseCode: latest.responseCode ?? null,
                  responseTimeMs: latest.responseTimeMs ?? null,
                  message: latest.message ?? null
                }
              ]
            : []
        };
      })
    }))
  };
};

export const enrichProjectRow = async (row: ProjectRow) => {
  const withResults = await attachLatestCheckResults(row);
  const inheritedSignal = resolveInheritedModuleSignal(withResults);
  const servicesWithSignals = withResults.Service.map((service) => {
    const hasDedicatedCheck = service.Check.some((check) => check.isActive);
    const isConnectionDiscoveredModule =
      service.type === "MODULE" && (service.OutgoingDependencies?.length ?? 0) > 0;

    if (!inheritedSignal || hasDedicatedCheck || !isConnectionDiscoveredModule) {
      return service;
    }

    return {
      ...service,
      status: inheritedSignal.status,
      healthDisplayLabel: inheritedSignal.displayLabel,
      healthReason: inheritedSignal.reason,
      healthSource: inheritedSignal.source,
      lastSignalAt: inheritedSignal.observedAt.toISOString()
    };
  });
  const openAlerts = withResults.Alert.filter((alert) => alert.status === "OPEN" || alert.status === "ACKNOWLEDGED");
  const unresolvedIncidents = withResults.Incident.filter((incident) => incident.status !== "RESOLVED");

  let inMaintenance = false;
  let verificationActive = false;
  if (withResults.organizationId) {
    const windows = await listActiveMaintenanceWindows({
      organizationId: withResults.organizationId,
      projectId: withResults.id
    });
    inMaintenance = windows.length > 0;
  }
  verificationActive = withResults.status === "RECOVERING" || (await hasActiveVerificationRun(withResults.id));

  const health = computeProjectHealth({
    storedStatus: withResults.status,
    healthReason: withResults.healthReason,
    monitoringEnabled: withResults.monitoringEnabled,
    isActive: withResults.isActive,
    inMaintenance,
    verificationActive,
    services: servicesWithSignals,
    openAlerts,
    unresolvedIncidents,
    lastHeartbeatAt: withResults.Heartbeat[0]?.receivedAt ?? null
  });

  return {
    ...withResults,
    Service: servicesWithSignals,
    status: health.status,
    healthReason: health.healthReason,
    healthSource: health.healthSource,
    healthDisplayLabel: health.displayLabel,
    lastCompletedCheckAt: health.lastCompletedCheckAt?.toISOString() ?? null,
    lastSignalAt: health.lastSignalAt?.toISOString() ?? null,
    monitoredAreaCount: health.monitoredAreaCount,
    affectedModules: health.affectedModules,
    affectedWorkflows: health.affectedWorkflows,
    affectedComponents: health.affectedComponents,
    services: servicesWithSignals,
    alerts: openAlerts,
    incidents: withResults.Incident,
    heartbeats: withResults.Heartbeat,
    billing: withResults.ProjectBilling
      ? (() => {
          const limits = {
            monthlyPrice: withResults.ProjectBilling.monthlyPrice,
            currency: withResults.ProjectBilling.currency,
            dataRetentionDays: withResults.ProjectBilling.dataRetentionDays,
            checkLimit: normalizeAllowanceLimit(withResults.ProjectBilling.checkLimit),
            userLimit: normalizeAllowanceLimit(withResults.ProjectBilling.userLimit),
            automationRunLimit: normalizeAllowanceLimit(withResults.ProjectBilling.automationRunLimit)
          };
          const pricingLabel = resolvePricingLabel(withResults.ProjectBilling.plan, limits);
          return {
            plan: withResults.ProjectBilling.plan,
            pricingLabel,
            isCustomPricing: pricingLabel === "CUSTOM",
            monthlyPrice: withResults.ProjectBilling.monthlyPrice,
            currency: withResults.ProjectBilling.currency,
            billingStatus: withResults.ProjectBilling.billingStatus
          };
        })()
      : null
  };
};

export const ensureProjectBilling = async (projectId: string, plan: BillingPlanType = "FREE") => {
  const existing = await getProjectBilling(projectId);
  if (existing) return existing;
  return createDefaultProjectBilling(projectId, plan);
};

export const writeBillingAudit = async (
  projectId: string,
  userId: string,
  action: string,
  metadata: Record<string, unknown>
) => {
  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      userId,
      action,
      entityType: "PROJECT",
      entityId: projectId,
      metadataJson: metadata as object
    }
  });
};

/** Lean includes — latest CheckResult is attached in enrichProjectRow (one SQL, not N+1 nested take). */
export const projectInclude = {
  Service: {
    include: {
      Check: true,
      OutgoingDependencies: {
        where: {
          dependencyType: "HIERARCHY" as const,
          source: "CONNECTION_DISCOVERY",
          isActive: true
        },
        select: { id: true },
        take: 1
      }
    }
  },
  Alert: { where: { status: { in: ["OPEN", "ACKNOWLEDGED"] as ("OPEN" | "ACKNOWLEDGED")[] } } },
  Incident: { where: { status: { in: ["OPEN", "INVESTIGATING", "MONITORING"] as ("OPEN" | "INVESTIGATING" | "MONITORING")[] } } },
  Heartbeat: { orderBy: { receivedAt: "desc" as const }, take: 1 },
  ProjectBilling: true,
  Connection: {
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      mode: true,
      health: true,
      healthReason: true,
      installationStatus: true,
      linkedServiceId: true,
      linkedCheckId: true,
      configurationJson: true,
      createdAt: true,
      lastSuccessAt: true,
      lastSyncAt: true,
      lastSyncStatus: true,
      syncIntervalMinutes: true
    }
  },
  NotificationChannel: {
    where: { isActive: true },
    select: { type: true, target: true, name: true }
  }
};

export const projectIncludeLite = {
  Service: {
    include: {
      Check: true
    }
  },
  Alert: { where: { status: { in: ["OPEN", "ACKNOWLEDGED"] as ("OPEN" | "ACKNOWLEDGED")[] } } },
  Incident: { where: { status: { in: ["OPEN", "INVESTIGATING", "MONITORING"] as ("OPEN" | "INVESTIGATING" | "MONITORING")[] } } },
  Heartbeat: { orderBy: { receivedAt: "desc" as const }, take: 1 },
  NotificationChannel: {
    where: { isActive: true },
    select: { type: true, target: true, name: true }
  }
};