import type { ProjectStatus } from "@prisma/client";
import { resolveMonitoringState, resolveServiceHealth, type ServiceHealthSignals } from "./service-health.service";

export type ProjectHealthSnapshot = {
  status: ProjectStatus;
  healthReason: string;
  healthSource: string;
  displayLabel: string;
  lastCompletedCheckAt: Date | null;
  lastSignalAt: Date | null;
  monitoredAreaCount: number;
  affectedModules: string[];
  affectedWorkflows: string[];
  affectedComponents: string[];
};

const CRITICALITY_RANK: Record<string, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFORMATIONAL: 1
};

export const healthDisplayLabel = (status: ProjectStatus): string => {
  switch (status) {
    case "UNKNOWN":
      return "Waiting for first heartbeat";
    case "MAINTENANCE":
      return "Maintenance";
    case "RECOVERING":
      return "Recovering";
    case "PAUSED":
      return "Paused";
    default:
      return status.charAt(0) + status.slice(1).toLowerCase();
  }
};

const mapTopologyToProjectStatus = (
  health: ReturnType<typeof resolveServiceHealth>,
  criticality: string
): ProjectStatus => {
  if (health === "UNKNOWN") return "UNKNOWN";
  if (health === "CRITICAL") {
    return criticality === "CRITICAL" || criticality === "HIGH" ? "DOWN" : "DEGRADED";
  }
  if (health === "DEGRADED") return "DEGRADED";
  return "HEALTHY";
};

const rankStatus = (status: ProjectStatus): number => {
  const order: Record<ProjectStatus, number> = {
    DOWN: 6,
    DEGRADED: 5,
    RECOVERING: 4,
    MAINTENANCE: 3,
    PAUSED: 2,
    UNKNOWN: 1,
    HEALTHY: 0
  };
  return order[status] ?? 0;
};

const worstProjectStatus = (statuses: ProjectStatus[]): ProjectStatus =>
  statuses.reduce((worst, current) => (rankStatus(current) > rankStatus(worst) ? current : worst), "HEALTHY");

type ServiceInput = {
  id: string;
  name: string;
  type: string;
  status: string;
  criticality: string;
  Check: Array<{
    isActive: boolean;
    CheckResult: Array<{ status: string; checkedAt: Date; responseCode?: number | null }>;
  }>;
};

export const buildServiceHealthSignals = (
  service: ServiceInput,
  openAlerts: number,
  criticalOpenAlerts: number,
  unresolvedIncidents: number
): ServiceHealthSignals => {
  const activeChecks = service.Check.filter((row) => row.isActive);
  const hasCompletedCheck = activeChecks.some((row) => row.CheckResult.length > 0);
  const latestResult = activeChecks.flatMap((row) => row.CheckResult).sort(
    (a, b) => b.checkedAt.getTime() - a.checkedAt.getTime()
  )[0];

  return {
    storedStatus: service.status,
    activeCheckCount: activeChecks.length,
    hasCompletedCheck,
    latestCheckFailed: latestResult?.status === "FAIL",
    openAlerts,
    criticalOpenAlerts,
    unresolvedIncidents
  };
};

export const computeProjectHealth = (input: {
  storedStatus: ProjectStatus;
  healthReason?: string | null;
  monitoringEnabled: boolean;
  isActive: boolean;
  inMaintenance?: boolean;
  verificationActive?: boolean;
  services: ServiceInput[];
  openAlerts: Array<{ serviceId: string | null; severity: string }>;
  unresolvedIncidents: Array<{ serviceId?: string | null }>;
  lastHeartbeatAt?: Date | null;
}): ProjectHealthSnapshot => {
  const alertsByService = new Map<string, { open: number; critical: number }>();
  for (const alert of input.openAlerts) {
    if (!alert.serviceId) continue;
    const bucket = alertsByService.get(alert.serviceId) ?? { open: 0, critical: 0 };
    bucket.open += 1;
    if (alert.severity === "CRITICAL" || alert.severity === "HIGH") bucket.critical += 1;
    alertsByService.set(alert.serviceId, bucket);
  }

  let lastCompletedCheckAt: Date | null = null;
  const serviceStatuses: Array<{ service: ServiceInput; status: ProjectStatus; health: ReturnType<typeof resolveServiceHealth> }> = [];

  for (const service of input.services) {
    const alertCounts = alertsByService.get(service.id) ?? { open: 0, critical: 0 };
    const signals = buildServiceHealthSignals(service, alertCounts.open, alertCounts.critical, 0);
    const health = resolveServiceHealth(signals);
    const status = mapTopologyToProjectStatus(health, service.criticality.toUpperCase());
    serviceStatuses.push({ service, status, health });

    for (const check of service.Check) {
      for (const result of check.CheckResult) {
        if (!lastCompletedCheckAt || result.checkedAt.getTime() > lastCompletedCheckAt.getTime()) {
          lastCompletedCheckAt = result.checkedAt;
        }
      }
    }
  }

  const lastSignalAt = lastCompletedCheckAt ?? input.lastHeartbeatAt ?? null;
  const anyCompletedCheck = lastCompletedCheckAt != null;
  const monitoredAreaCount = input.services.length;

  const affectedComponents = serviceStatuses
    .filter((row) => row.service.type === "COMPONENT" && row.status !== "HEALTHY" && row.status !== "UNKNOWN")
    .map((row) => row.service.name);
  const affectedWorkflows = serviceStatuses
    .filter((row) => row.service.type === "WORKFLOW" && row.status !== "HEALTHY" && row.status !== "UNKNOWN")
    .map((row) => row.service.name);
  const affectedModules = serviceStatuses
    .filter((row) => row.service.type === "MODULE" && row.status !== "HEALTHY" && row.status !== "UNKNOWN")
    .map((row) => row.service.name);

  if (!input.isActive || !input.monitoringEnabled) {
    return {
      status: "PAUSED",
      healthReason: "Monitoring paused by configuration",
      healthSource: "policy",
      displayLabel: healthDisplayLabel("PAUSED"),
      lastCompletedCheckAt,
      lastSignalAt,
      monitoredAreaCount,
      affectedModules,
      affectedWorkflows,
      affectedComponents
    };
  }

  if (input.inMaintenance) {
    return {
      status: "MAINTENANCE",
      healthReason: "Approved maintenance window is active",
      healthSource: "maintenance-window",
      displayLabel: healthDisplayLabel("MAINTENANCE"),
      lastCompletedCheckAt,
      lastSignalAt,
      monitoredAreaCount,
      affectedModules,
      affectedWorkflows,
      affectedComponents
    };
  }

  if (input.storedStatus === "RECOVERING" || input.verificationActive) {
    return {
      status: "RECOVERING",
      healthReason: input.healthReason ?? "Remediation completed; awaiting verification checks",
      healthSource: "automation-recovery",
      displayLabel: healthDisplayLabel("RECOVERING"),
      lastCompletedCheckAt,
      lastSignalAt,
      monitoredAreaCount,
      affectedModules,
      affectedWorkflows,
      affectedComponents
    };
  }

  if (!anyCompletedCheck && input.openAlerts.length === 0 && input.unresolvedIncidents.length === 0) {
    return {
      status: "UNKNOWN",
      healthReason: "Waiting for first heartbeat",
      healthSource: "monitoring",
      displayLabel: healthDisplayLabel("UNKNOWN"),
      lastCompletedCheckAt: null,
      lastSignalAt,
      monitoredAreaCount,
      affectedModules: [],
      affectedWorkflows: [],
      affectedComponents: []
    };
  }

  const rollupCandidates = serviceStatuses
    .filter((row) => row.health !== "UNKNOWN")
    .map((row) => row.status);

  const rolled = rollupCandidates.length > 0 ? worstProjectStatus(rollupCandidates) : "HEALTHY";

  let healthReason = input.healthReason ?? "";
  if (!healthReason) {
    if (rolled === "HEALTHY") {
      healthReason = anyCompletedCheck ? "All monitored areas are healthy" : "Waiting for first heartbeat";
    } else if (rolled === "DOWN") {
      const critical = serviceStatuses.find((row) => row.status === "DOWN");
      healthReason = critical
        ? `${critical.service.name} is unavailable`
        : "A critical workflow is unavailable";
    } else if (rolled === "DEGRADED") {
      const degraded = serviceStatuses.find((row) => row.status === "DEGRADED");
      healthReason = degraded
        ? `${degraded.service.name} has partial impairment`
        : "One or more monitored areas are degraded";
    } else {
      healthReason = healthDisplayLabel(rolled);
    }
  }

  if (rolled === "DEGRADED" && !anyCompletedCheck && input.openAlerts.length === 0) {
    return {
      status: "UNKNOWN",
      healthReason: "Waiting for first heartbeat",
      healthSource: "monitoring",
      displayLabel: healthDisplayLabel("UNKNOWN"),
      lastCompletedCheckAt: null,
      lastSignalAt,
      monitoredAreaCount,
      affectedModules: [],
      affectedWorkflows: [],
      affectedComponents: []
    };
  }

  return {
    status: rolled,
    healthReason,
    healthSource: "rollup",
    displayLabel: healthDisplayLabel(rolled),
    lastCompletedCheckAt,
    lastSignalAt,
    monitoredAreaCount,
    affectedModules,
    affectedWorkflows,
    affectedComponents
  };
};

export const criticalityWeight = (criticality: string): number =>
  CRITICALITY_RANK[criticality.toUpperCase()] ?? CRITICALITY_RANK.MEDIUM!;
