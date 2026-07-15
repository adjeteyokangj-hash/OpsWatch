import { randomUUID } from "crypto";
import type { BillingPlanType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { loadLatestCheckResultsByCheckIds } from "./check-result-batch.service";
import { computeProjectHealth } from "./project-health.service";
import { createDefaultProjectBilling, getProjectBilling, normalizeAllowanceLimit, resolvePricingLabel } from "./project-billing.service";
import { listActiveMaintenanceWindows } from "./maintenance-window-policy.service";
import { hasActiveVerificationRun } from "./project-recovery-lifecycle.service";

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
      CheckResult: Array<{ status: string; checkedAt: Date; responseCode?: number | null }>;
    }>;
  }>;
  Alert: Array<{ serviceId: string | null; severity: string; status: string }>;
  Incident: Array<{ status: string; serviceId?: string | null }>;
  Heartbeat: Array<{ receivedAt: Date }>;
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
                  responseCode: latest.responseCode ?? null
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
    services: withResults.Service,
    openAlerts,
    unresolvedIncidents,
    lastHeartbeatAt: withResults.Heartbeat[0]?.receivedAt ?? null
  });

  return {
    ...withResults,
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
    services: withResults.Service,
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
      Check: true
    }
  },
  Alert: { where: { status: { in: ["OPEN", "ACKNOWLEDGED"] as ("OPEN" | "ACKNOWLEDGED")[] } } },
  Incident: { where: { status: { in: ["OPEN", "INVESTIGATING", "MONITORING"] as ("OPEN" | "INVESTIGATING" | "MONITORING")[] } } },
  Heartbeat: { orderBy: { receivedAt: "desc" as const }, take: 1 },
  ProjectBilling: true,
  Connection: {
    where: { isActive: true },
    select: { id: true, name: true }
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
