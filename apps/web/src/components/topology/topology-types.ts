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
};

export const LAYER_ORDER: TopologyNodeType[] = ["APP", "MODULE", "WORKFLOW", "COMPONENT"];

export const healthLabel = (status: TopologyHealthStatus): string => {
  if (status === "UNKNOWN") return "Waiting for first heartbeat";
  return status.charAt(0) + status.slice(1).toLowerCase();
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
