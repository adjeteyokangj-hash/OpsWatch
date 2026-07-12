/**
 * Explicit Data Transfer Object types for all list and detail endpoints.
 * These are the stable frontend contracts — decouple the API response shape from
 * the Prisma model shape so schema changes don't silently break callers.
 */

// ─── Shared primitives ───────────────────────────────────────────────────────

export type ProjectRefDto = {
  id: string;
  name: string;
};

export type ServiceRefDto = {
  id: string;
  name: string;
};

export type UserRefDto = {
  id: string;
  name: string;
  email: string;
};

// ─── Alert DTOs ──────────────────────────────────────────────────────────────

export type AlertListItemDto = {
  id: string;
  title: string;
  message: string;
  severity: string;
  status: string;
  category: string;
  sourceType: string;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  project: ProjectRefDto;
  service: ServiceRefDto | null;
};

export type IncidentRefDto = {
  id: string;
  title: string;
  severity: string;
  status: string;
  openedAt: string;
};

export type AlertDetailDto = AlertListItemDto & {
  assignedTo: UserRefDto | null;
  incidents: IncidentRefDto[];
};

// ─── Incident DTOs ───────────────────────────────────────────────────────────

export type IncidentListItemDto = {
  id: string;
  title: string;
  severity: string;
  status: string;
  openedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  project: ProjectRefDto;
};

export type AlertRefDto = {
  id: string;
  title: string;
  severity: string;
  status: string;
  lastSeenAt: string;
  service: ServiceRefDto | null;
};

export type OrganizationIncidentGroupDto = {
  id: string;
  correlationKey: string;
  rootCauseSummary: string | null;
  primaryIncidentId: string | null;
  relatedIncidents: Array<{
    id: string;
    title: string;
    severity: string;
    status: string;
    project: ProjectRefDto;
  }>;
};

export type IncidentDetailDto = IncidentListItemDto & {
  rootCause: string | null;
  resolutionNotes: string | null;
  alerts: AlertRefDto[];
  correlationGroup: OrganizationIncidentGroupDto | null;
};

export type IncidentTimelineEventDto = {
  id: string;
  incidentId: string;
  projectId: string;
  eventType: string;
  summary: string;
  sourceType: string | null;
  sourceId: string | null;
  severity: string | null;
  occurredAt: string;
  createdAt: string;
  payloadJson: unknown;
};

export type RootCauseCandidateDto = {
  kind: "CHANGE_EVENT" | "DEPENDENCY" | "ALERT_SIGNAL";
  referenceId: string;
  title: string;
  score: number;
  rationale: string;
  metadata: Record<string, unknown>;
};

// ─── Causal graph DTOs ─────────────────────────────────────────────────────────

export type CausalEvidenceType = "OBSERVED" | "INFERRED" | "AI_SUGGESTED";

export type RootCauseOverlayDto = {
  nodeId: string;
  rank: number;
  confidence: number | null;
  reason: string;
  evidenceType: CausalEvidenceType;
};

export type PropagationOverlayDto = {
  sourceId: string;
  targetId: string;
  order: number;
  confidence: number | null;
  evidence: string[];
};

export type ChangeEventNodeDto = {
  id: string;
  type: "DEPLOYMENT" | "CONFIG_CHANGE" | "MAINTENANCE" | "MANUAL_ACTION";
  title: string;
  occurredAt: string;
  serviceId: string | null;
  actor: string | null;
};

export type CorrelatedIncidentNodeDto = {
  incidentId: string;
  projectId: string;
  projectName: string;
  title: string;
  severity: string;
  serviceIds: string[];
};

export type CausalEvidenceDto = {
  type: CausalEvidenceType;
  description: string;
  source: string | null;
};

export type IncidentCausalGraphResponse = {
  incident: {
    id: string;
    projectId: string;
    title: string;
    status: string;
    severity: string;
  };
  topology: ProjectTopologyResponse;
  overlay: {
    probableRootCauses: RootCauseOverlayDto[];
    propagationEdges: PropagationOverlayDto[];
    affectedNodeIds: string[];
    incidentNodeIds: string[];
    changeEvents: ChangeEventNodeDto[];
    correlatedIncidents: CorrelatedIncidentNodeDto[];
  };
  explanation: {
    summary: string | null;
    confidence: number | null;
    evidence: CausalEvidenceDto[];
  };
  generatedAt: string;
};

// ─── Check DTOs ──────────────────────────────────────────────────────────────

export type CheckResultDto = {
  id: string;
  status: string;
  responseCode: number | null;
  responseTimeMs: number | null;
  message: string | null;
  checkedAt: string;
};

export type CheckListItemDto = {
  id: string;
  name: string;
  type: string;
  intervalSeconds: number;
  timeoutMs: number;
  isActive: boolean;
  service: ServiceRefDto & { project: ProjectRefDto };
  latestResult: CheckResultDto | null;
};

export type CheckStatusSummaryDto = {
  total: number;
  pass: number;
  fail: number;
  warn: number;
  pending: number;
};

export type CheckListResponseDto = {
  items: CheckListItemDto[];
  summary: CheckStatusSummaryDto;
};

export type CheckDetailDto = {
  id: string;
  name: string;
  type: string;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatusCode: number | null;
  expectedKeyword: string | null;
  failureThreshold: number;
  recoveryThreshold: number;
  configJson: unknown;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  service: ServiceRefDto & { project: ProjectRefDto };
  latestResult: CheckResultDto | null;
  recentResults: CheckResultDto[];
  statusSummary: CheckStatusSummaryDto;
};

// ─── Topology DTOs ───────────────────────────────────────────────────────────

export type TopologyHealthStatus = "HEALTHY" | "DEGRADED" | "CRITICAL" | "UNKNOWN";

export type TopologyNodeType = "APP" | "MODULE" | "WORKFLOW" | "COMPONENT";

export type TopologyNodeMetrics = {
  availabilityPercent: number | null;
  latencyMs: number | null;
  errorRatePercent: number | null;
  sloBurnRate: number | null;
};

export type TopologyNodeRisk = {
  openAlerts: number;
  unresolvedIncidents: number;
};

export type TopologyNode = {
  id: string;
  name: string;
  type: TopologyNodeType;
  status: TopologyHealthStatus;
  parentId: string | null;
  metrics: TopologyNodeMetrics;
  risk: TopologyNodeRisk;
};

export type TopologyEdgeType = "HIERARCHY" | "DEPENDENCY";

export type TopologyEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  type: TopologyEdgeType;
  critical: boolean;
  status: TopologyHealthStatus;
};

export type TopologySummary = {
  total: number;
  healthy: number;
  degraded: number;
  critical: number;
  unknown: number;
  openAlerts: number;
  openIncidents: number;
};

export type TopologyMonitoringState = "AWAITING_FIRST_CHECK" | "MONITORED";

export type TopologyNodeContext = {
  monitoringState: TopologyMonitoringState;
  lastCheckAt: string | null;
  lastCheckStatus: string | null;
  sloStatus: string | null;
  openAlerts: Array<{ id: string; title: string; severity: string; status: string }>;
  unresolvedIncidents: Array<{ id: string; title: string; severity: string; status: string }>;
  upstreamIds: string[];
  downstreamIds: string[];
};

export type ProjectTopologyResponse = {
  project: {
    id: string;
    name: string;
    status: string;
  };
  generatedAt: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  summary: TopologySummary;
  nodeContext: Record<string, TopologyNodeContext>;
};
