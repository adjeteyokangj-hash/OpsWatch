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

/**
 * Legacy helper — prefers target node health for dependency edges.
 * Prefer `resolveRelationshipEdgeHealth` for evidence-based colouring.
 */
export const resolveDependencyEdgeHealth = (
  targetHealth: TopologyHealthStatus,
  _critical: boolean
): TopologyHealthStatus => {
  if (targetHealth === "UNKNOWN") return "UNKNOWN";
  if (targetHealth === "CRITICAL") return "CRITICAL";
  if (targetHealth === "DEGRADED") return "DEGRADED";
  return "HEALTHY";
};

export type RelationshipEdgeHealthInput = {
  /** Post-rollup status of the dependency source (caller). */
  sourceHealth: TopologyHealthStatus;
  /** Post-rollup status of the dependency target (callee / dependency). */
  targetHealth: TopologyHealthStatus;
  relatedOpenAlerts: number;
  relatedCriticalAlerts: number;
  relatedFailedChecks: number;
  relatedWarnChecks: number;
  /** True when the target (or both ends for hierarchy) has monitoring evidence. */
  hasTargetEvidence: boolean;
  /** True when either endpoint has recent check/heartbeat/Slo evidence. */
  hasAnyEndpointEvidence: boolean;
};

export type RelationshipEdgeHealthResult = {
  status: TopologyHealthStatus;
  reason: string;
};

/**
 * Evidence-based relationship health for DEPENDENCY / traffic edges.
 * Does not invent green from source-only health when the dependency itself is unmonitored.
 * Does not paint amber solely because the caller node is degraded while the dependency target is healthy.
 */
export const resolveRelationshipEdgeHealth = (
  input: RelationshipEdgeHealthInput
): RelationshipEdgeHealthResult => {
  if (input.relatedCriticalAlerts > 0 || input.relatedFailedChecks > 0) {
    return {
      status: "CRITICAL",
      reason: "Active failed check or critical/high alert on a relationship endpoint"
    };
  }

  if (input.targetHealth === "CRITICAL") {
    return {
      status: "CRITICAL",
      reason: "Dependency target health is CRITICAL"
    };
  }

  if (input.relatedOpenAlerts > 0 || input.relatedWarnChecks > 0 || input.targetHealth === "DEGRADED") {
    return {
      status: "DEGRADED",
      reason: "Warning check, open alert, or degraded dependency target"
    };
  }

  if (input.hasTargetEvidence && input.targetHealth === "HEALTHY") {
    return {
      status: "HEALTHY",
      reason: "Recent successful monitoring evidence on the dependency target"
    };
  }

  if (
    input.hasAnyEndpointEvidence &&
    input.targetHealth === "HEALTHY" &&
    input.sourceHealth === "HEALTHY"
  ) {
    return {
      status: "HEALTHY",
      reason: "Both relationship endpoints are healthy with monitoring evidence"
    };
  }

  if (input.sourceHealth === "CRITICAL" && input.hasAnyEndpointEvidence) {
    return {
      status: "CRITICAL",
      reason: "Source endpoint is CRITICAL while this dependency remains in the failing path"
    };
  }

  return {
    status: "UNKNOWN",
    reason:
      "No recent relationship evidence — declared dependency without conclusive checks, heartbeat, or linked alerts"
  };
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
