export type TopologyHealthStatus = "HEALTHY" | "DEGRADED" | "CRITICAL" | "UNKNOWN";

export type TopologyNodeType = "APP" | "MODULE" | "WORKFLOW" | "COMPONENT";

export type TopologyNode = {
  id: string;
  name: string;
  type: TopologyNodeType;
  status: TopologyHealthStatus;
  parentId: string | null;
  metrics: {
    availabilityPercent: number | null;
    latencyMs: number | null;
    errorRatePercent: number | null;
    sloBurnRate: number | null;
    availabilityTrend: number[];
  };
  risk: {
    openAlerts: number;
    unresolvedIncidents: number;
  };
};

export type TopologyEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  type: "HIERARCHY" | "DEPENDENCY";
  critical: boolean;
  status: TopologyHealthStatus;
  otel?: {
    source: string;
    health: string | null;
    discoveryState: string | null;
  };
};

export type TopologyNodeContext = {
  monitoringState: "AWAITING_FIRST_CHECK" | "MONITORED";
  lastCheckAt: string | null;
  lastCheckStatus: string | null;
  sloStatus: string | null;
  openAlerts: Array<{ id: string; title: string; severity: string; status: string }>;
  unresolvedIncidents: Array<{ id: string; title: string; severity: string; status: string }>;
  upstreamIds: string[];
  downstreamIds: string[];
  otel?: {
    connected: boolean;
    discoveryState: string | null;
    health: string | null;
    confidence: number | null;
    freshness: "FRESH" | "STALE" | "INACTIVE" | "UNKNOWN";
    signalCount: number;
    lastSeenAt: string | null;
    source: string | null;
  };
};

export type ProjectTopologyResponse = {
  project: { id: string; name: string; status: string };
  generatedAt: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    critical: number;
    unknown: number;
    openAlerts: number;
    openIncidents: number;
  };
  nodeContext: Record<string, TopologyNodeContext>;
  otelOverlay?: {
    enabled: boolean;
    entities: number;
    relationships: number;
    freshSignals: number;
    staleEntities: number;
  };
};

export const LAYER_ORDER: TopologyNodeType[] = ["APP", "MODULE", "WORKFLOW", "COMPONENT"];

export const healthLabel = (status: TopologyHealthStatus): string => {
  if (status === "UNKNOWN") return "Unknown";
  return status.charAt(0) + status.slice(1).toLowerCase();
};

/** Honest explanation when health cannot be confirmed from real checks/heartbeats. */
export const unknownHealthReason = (input: {
  monitoringState?: "AWAITING_FIRST_CHECK" | "MONITORED" | string | null;
  lastCheckAt?: string | null;
  openAlerts?: number;
}): string => {
  if (input.monitoringState === "AWAITING_FIRST_CHECK" || !input.lastCheckAt) {
    return "Health is unknown because no completed check or heartbeat has been recorded for this node yet.";
  }
  if ((input.openAlerts ?? 0) === 0) {
    return "Health is unknown because recent monitoring signals are missing or inconclusive — not because a failure was detected.";
  }
  return "Health is unknown while OpsWatch waits for a conclusive check result. Open alerts may still appear from other signals.";
};

export const riskLabel = (risk: { openAlerts: number; unresolvedIncidents: number }): string | null => {
  const parts: string[] = [];
  if (risk.openAlerts > 0) {
    parts.push(`${risk.openAlerts} open alert${risk.openAlerts === 1 ? "" : "s"}`);
  }
  if (risk.unresolvedIncidents > 0) {
    parts.push(`${risk.unresolvedIncidents} open incident${risk.unresolvedIncidents === 1 ? "" : "s"}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
};

export type CausalEvidenceType = "OBSERVED" | "INFERRED" | "AI_SUGGESTED";

export type TopologyOverlays = {
  rootCauses?: Array<{
    nodeId: string;
    rank: number;
    confidence: number | null;
    reason: string;
    evidenceType: CausalEvidenceType;
  }>;
  propagationEdges?: Array<{
    sourceId: string;
    targetId: string;
    order: number;
    confidence: number | null;
    evidence: string[];
  }>;
  affectedNodeIds?: string[];
  incidentNodeIds?: string[];
  changeEvents?: Array<{
    id: string;
    type: "DEPLOYMENT" | "CONFIG_CHANGE" | "MAINTENANCE" | "MANUAL_ACTION";
    title: string;
    occurredAt: string;
    serviceId: string | null;
    actor: string | null;
  }>;
  correlatedIncidents?: Array<{
    incidentId: string;
    projectId: string;
    projectName: string;
    title: string;
    severity: string;
    serviceIds: string[];
  }>;
};

export const evidenceTypeLabel = (type: CausalEvidenceType): string => {
  if (type === "OBSERVED") return "Observed";
  if (type === "INFERRED") return "High-confidence inference";
  return "AI hypothesis";
};

export const healthClassName = (status: TopologyHealthStatus): string => {
  if (status === "HEALTHY") return "topology-health-healthy";
  if (status === "CRITICAL") return "topology-health-critical";
  if (status === "DEGRADED") return "topology-health-degraded";
  return "topology-health-unknown";
};
