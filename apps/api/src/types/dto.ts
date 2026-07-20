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
  /** Linked incidents via IncidentAlert join — real links only. */
  linkedIncidents: Array<{ id: string; title: string; status: string }>;
  assignedTo: UserRefDto | null;
};

export type IncidentRefDto = {
  id: string;
  title: string;
  severity: string;
  status: string;
  openedAt: string;
};

export type AlertDetailDto = AlertListItemDto & {
  incidents: IncidentRefDto[];
  otelEvidence?: Array<{
    id: string;
    evidenceKind: string;
    summary: string;
    confidence: number | null;
    traceId: string | null;
    spanId: string | null;
    observedAt: string;
  }>;
  /** Phase 6 searchable log / APM evidence links (additive). */
  logEvidence?: Array<{
    id: string;
    evidenceKind: string;
    summary: string;
    confidence: number | null;
    occurrenceGroupId: string | null;
    logRecordId: string | null;
    observedAt: string;
  }>;
  spanEvidence?: Array<{
    id: string;
    evidenceKind: string;
    summary: string;
    confidence: number | null;
    traceId: string | null;
    spanId: string | null;
    observedAt: string;
  }>;
  apmEvidence?: Array<{
    id: string;
    evidenceKind: string;
    summary: string;
    confidence: number | null;
    serviceWindowId: string | null;
    endpointWindowId: string | null;
    dependencyWindowId: string | null;
    observedAt: string;
  }>;
  operationalEntityId?: string | null;
  operationalRelationshipId?: string | null;
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
  /** Only present when recorded — never invented. */
  rootCause: string | null;
  project: ProjectRefDto & { owner: string | null };
  alertCount: number;
  affectedServices: Array<{ id: string; name: string }>;
  /** Operational owner from project metadata when set. */
  owner: string | null;
  correlatedDeployCount: number;
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
  resolutionNotes: string | null;
  alerts: AlertRefDto[];
  correlationGroup: OrganizationIncidentGroupDto | null;
  otelEvidence?: Array<{
    id: string;
    evidenceKind: string;
    summary: string;
    confidence: number | null;
    traceId: string | null;
    spanId: string | null;
    propagationDirection: string | null;
    candidateRootCause: boolean;
    observedAt: string;
  }>;
  logEvidence?: Array<{
    id: string;
    evidenceKind: string;
    summary: string;
    confidence: number | null;
    occurrenceGroupId: string | null;
    observedAt: string;
  }>;
  spanEvidence?: Array<{
    id: string;
    evidenceKind: string;
    summary: string;
    confidence: number | null;
    traceId: string | null;
    spanId: string | null;
    observedAt: string;
  }>;
  apmEvidence?: Array<{
    id: string;
    evidenceKind: string;
    summary: string;
    confidence: number | null;
    serviceWindowId: string | null;
    dependencyWindowId: string | null;
    observedAt: string;
  }>;
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
  /** Evidence-derived only — never invents certainty without supporting signals. */
  confidenceLabel: "POSSIBLE" | "PROBABLE" | "CONFIRMED";
  rationale: string;
  alternativeCauses?: string[];
  evidenceSummary?: string[];
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
  availabilityTrend: number[];
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
  provenance?: string;
  confidence?: number | null;
  discoveryState?: string;
  freshness?: "FRESH" | "STALE" | "INACTIVE" | "UNKNOWN";
  confirmationState?: string;
  otel?: {
    source: string;
    health: string | null;
    discoveryState: string | null;
  };
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
  /** Operator-facing recovery overlay while alerts remain open. */
  recoveryState?: "RECOVERING" | "VERIFYING" | "RECOVERED" | null;
  openAlerts: Array<{ id: string; title: string; severity: string; status: string }>;
  unresolvedIncidents: Array<{ id: string; title: string; severity: string; status: string }>;
  upstreamIds: string[];
  downstreamIds: string[];
  canonical?: {
    environment: string;
    entityType: string;
    provenance: string;
    discoverySource: string | null;
    discoveryState: string;
    freshness: "FRESH" | "STALE" | "INACTIVE" | "UNKNOWN";
    confidence: number | null;
    confirmationState: string;
    sharedScope: string;
    isTestSeed: boolean;
    legacyServiceId: string | null;
    location: {
      id: string;
      name: string;
      type: string;
    } | null;
  };
  /** Phase 3 OTEL adapter overlay (optional; absent when no OTEL evidence). */
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
  otelOverlay?: {
    enabled: boolean;
    entities: number;
    relationships: number;
    freshSignals: number;
    staleEntities: number;
  };
  readerDiagnostic?: TopologyReaderDiagnostic;
};

export type TopologyReaderDiagnostic = {
  reader: "CANONICAL" | "LEGACY";
  fallbackUsed: boolean;
  canonicalEntityCount: number;
  canonicalRelationshipCount: number;
  legacyFallbackCount: number;
  unresolvedCanonicalReferences: number;
  details: string[];
};
