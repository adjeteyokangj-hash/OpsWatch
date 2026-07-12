export type TopologyHealthStatus = "HEALTHY" | "DEGRADED" | "CRITICAL" | "UNKNOWN";

export type TopologyMonitoringState = "AWAITING_FIRST_CHECK" | "MONITORED";

export type ServiceHealthSignals = {
  storedStatus: string;
  activeCheckCount: number;
  hasCompletedCheck: boolean;
  latestCheckFailed: boolean;
  openAlerts: number;
  criticalOpenAlerts: number;
  unresolvedIncidents: number;
  sloStatus?: string | null;
};

export const resolveMonitoringState = (signals: Pick<ServiceHealthSignals, "activeCheckCount" | "hasCompletedCheck">): TopologyMonitoringState =>
  signals.activeCheckCount === 0 || !signals.hasCompletedCheck ? "AWAITING_FIRST_CHECK" : "MONITORED";

export const resolveServiceHealth = (signals: ServiceHealthSignals): TopologyHealthStatus => {
  const monitoringState = resolveMonitoringState(signals);

  if (monitoringState === "AWAITING_FIRST_CHECK") {
    return "UNKNOWN";
  }

  if (signals.storedStatus === "DOWN" || signals.criticalOpenAlerts > 0) {
    return "CRITICAL";
  }

  if (
    signals.openAlerts > 0 ||
    signals.unresolvedIncidents > 0 ||
    signals.latestCheckFailed ||
    signals.storedStatus === "DEGRADED" ||
    (signals.sloStatus && signals.sloStatus !== "HEALTHY")
  ) {
    return "DEGRADED";
  }

  return "HEALTHY";
};

export const resolveDependencyEdgeHealth = (
  targetHealth: TopologyHealthStatus,
  critical: boolean
): TopologyHealthStatus => {
  if (targetHealth === "UNKNOWN") return "UNKNOWN";
  if (targetHealth === "CRITICAL") return "CRITICAL";
  if (targetHealth === "DEGRADED") return critical ? "DEGRADED" : "DEGRADED";
  return "HEALTHY";
};

export const worstHealth = (values: TopologyHealthStatus[]): TopologyHealthStatus => {
  const rank: Record<TopologyHealthStatus, number> = {
    CRITICAL: 4,
    DEGRADED: 3,
    UNKNOWN: 2,
    HEALTHY: 1
  };
  return values.reduce<TopologyHealthStatus>(
    (worst, current) => (rank[current] > rank[worst] ? current : worst),
    "HEALTHY"
  );
};
