import { randomUUID } from "crypto";
import type { BillingPlanType } from "@prisma/client";
import { prisma } from "../lib/prisma";
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

export const enrichProjectRow = async (row: ProjectRow) => {
  const openAlerts = row.Alert.filter((alert) => alert.status === "OPEN" || alert.status === "ACKNOWLEDGED");
  const unresolvedIncidents = row.Incident.filter((incident) => incident.status !== "RESOLVED");

  let inMaintenance = false;
  let verificationActive = false;
  if (row.organizationId) {
    const windows = await listActiveMaintenanceWindows({
      organizationId: row.organizationId,
      projectId: row.id
    });
    inMaintenance = windows.length > 0;
  }
  verificationActive = row.status === "RECOVERING" || (await hasActiveVerificationRun(row.id));

  const health = computeProjectHealth({
    storedStatus: row.status,
    healthReason: row.healthReason,
    monitoringEnabled: row.monitoringEnabled,
    isActive: row.isActive,
    inMaintenance,
    verificationActive,
    services: row.Service,
    openAlerts,
    unresolvedIncidents,
    lastHeartbeatAt: row.Heartbeat[0]?.receivedAt ?? null
  });

  return {
    ...row,
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
    services: row.Service,
    alerts: openAlerts,
    incidents: row.Incident,
    heartbeats: row.Heartbeat,
    billing: row.ProjectBilling
      ? (() => {
          const limits = {
            monthlyPrice: row.ProjectBilling.monthlyPrice,
            currency: row.ProjectBilling.currency,
            dataRetentionDays: row.ProjectBilling.dataRetentionDays,
            checkLimit: normalizeAllowanceLimit(row.ProjectBilling.checkLimit),
            userLimit: normalizeAllowanceLimit(row.ProjectBilling.userLimit),
            automationRunLimit: normalizeAllowanceLimit(row.ProjectBilling.automationRunLimit)
          };
          const pricingLabel = resolvePricingLabel(row.ProjectBilling.plan, limits);
          return {
            plan: row.ProjectBilling.plan,
            pricingLabel,
            isCustomPricing: pricingLabel === "CUSTOM",
            monthlyPrice: row.ProjectBilling.monthlyPrice,
            currency: row.ProjectBilling.currency,
            billingStatus: row.ProjectBilling.billingStatus
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

export const projectInclude = {
  Service: {
    include: {
      Check: {
        include: {
          CheckResult: { orderBy: { checkedAt: "desc" as const }, take: 1 }
        }
      }
    }
  },
  Alert: { where: { status: { in: ["OPEN", "ACKNOWLEDGED"] as ("OPEN" | "ACKNOWLEDGED")[] } } },
  Incident: { where: { status: { in: ["OPEN", "INVESTIGATING", "MONITORING"] as ("OPEN" | "INVESTIGATING" | "MONITORING")[] } } },
  Heartbeat: { orderBy: { receivedAt: "desc" as const }, take: 1 },
  ProjectBilling: true,
  NotificationChannel: {
    where: { isActive: true },
    select: { type: true, target: true, name: true }
  }
};

export const projectIncludeLite = {
  Service: {
    include: {
      Check: {
        include: {
          CheckResult: { orderBy: { checkedAt: "desc" as const }, take: 1 }
        }
      }
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
