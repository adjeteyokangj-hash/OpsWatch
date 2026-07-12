import type { DeepDiagnosisResult } from "./ai/incident-analysis.service";
import type {
  CausalEvidenceDto,
  CausalEvidenceType,
  ChangeEventNodeDto,
  CorrelatedIncidentNodeDto,
  IncidentCausalGraphResponse,
  ProjectTopologyResponse,
  PropagationOverlayDto,
  RootCauseCandidateDto,
  RootCauseOverlayDto
} from "../types/dto";

const topologyNodeIds = (topology: ProjectTopologyResponse): Set<string> =>
  new Set(topology.nodes.map((row) => row.id));

const safeNodeId = (nodeId: string | null | undefined, validIds: Set<string>): string | null =>
  nodeId && validIds.has(nodeId) ? nodeId : null;

export const mapChangeEventType = (
  eventType: string
): ChangeEventNodeDto["type"] => {
  if (/(DEPLOY|ROLLBACK|RELEASE)/i.test(eventType)) return "DEPLOYMENT";
  if (/(CONFIG|MIGRATION)/i.test(eventType)) return "CONFIG_CHANGE";
  if (/MAINTENANCE/i.test(eventType)) return "MAINTENANCE";
  return "MANUAL_ACTION";
};

export const classifyCandidateEvidence = (
  candidate: RootCauseCandidateDto,
  analysisMode: string
): CausalEvidenceType => {
  if (analysisMode === "LLM") return "AI_SUGGESTED";
  if (candidate.kind === "ALERT_SIGNAL") return "OBSERVED";
  if (candidate.kind === "CHANGE_EVENT") return "OBSERVED";
  return "INFERRED";
};

export const classifyAnalysisEvidence = (
  type: string,
  analysisMode: string
): CausalEvidenceType => {
  if (analysisMode === "LLM") return "AI_SUGGESTED";
  if (type === "ALERT" || type === "TIMELINE" || type === "CHANGE") return "OBSERVED";
  return "INFERRED";
};

const candidateServiceId = (candidate: RootCauseCandidateDto): string | null => {
  const metadata = candidate.metadata ?? {};
  if (typeof metadata.serviceId === "string") return metadata.serviceId;
  if (candidate.kind === "DEPENDENCY" && typeof metadata.toServiceId === "string") {
    return metadata.toServiceId;
  }
  return null;
};

export const buildRootCauseOverlays = (input: {
  topology: ProjectTopologyResponse;
  diagnosis: DeepDiagnosisResult;
  candidates: RootCauseCandidateDto[];
}): RootCauseOverlayDto[] => {
  const validIds = topologyNodeIds(input.topology);
  const overlays: RootCauseOverlayDto[] = [];
  const seen = new Set<string>();

  const root = input.diagnosis.dependencyImpact?.probableRootCause;
  if (root && validIds.has(root.serviceId)) {
    overlays.push({
      nodeId: root.serviceId,
      rank: 1,
      confidence: input.diagnosis.confidence != null ? Math.round(input.diagnosis.confidence * 100) : null,
      reason: root.rationale,
      evidenceType: input.diagnosis.analysisMode === "LLM" ? "AI_SUGGESTED" : "INFERRED"
    });
    seen.add(root.serviceId);
  }

  let rank = overlays.length + 1;
  for (const candidate of input.candidates) {
    const nodeId = safeNodeId(candidateServiceId(candidate), validIds);
    if (!nodeId || seen.has(nodeId)) continue;
    overlays.push({
      nodeId,
      rank,
      confidence: Math.round(candidate.score * 100),
      reason: candidate.rationale,
      evidenceType: classifyCandidateEvidence(candidate, input.diagnosis.analysisMode)
    });
    seen.add(nodeId);
    rank += 1;
    if (overlays.length >= 5) break;
  }

  return overlays;
};

export const buildPropagationOverlays = (input: {
  topology: ProjectTopologyResponse;
  diagnosis: DeepDiagnosisResult;
}): PropagationOverlayDto[] => {
  const validIds = topologyNodeIds(input.topology);
  const chain = input.diagnosis.dependencyImpact?.propagationChain ?? [];
  const confidence =
    input.diagnosis.confidence != null ? Math.round(input.diagnosis.confidence * 100) : null;

  return chain
    .map((hop, index) => ({
      sourceId: hop.toServiceId,
      targetId: hop.fromServiceId,
      order: index + 1,
      confidence,
      evidence: [hop.relationship]
    }))
    .filter((row) => validIds.has(row.sourceId) && validIds.has(row.targetId));
};

export const buildAffectedNodeIds = (input: {
  topology: ProjectTopologyResponse;
  diagnosis: DeepDiagnosisResult;
  incidentServiceIds: string[];
}): string[] => {
  const validIds = topologyNodeIds(input.topology);
  const affected = new Set<string>();

  for (const row of input.diagnosis.layerImpacts ?? input.diagnosis.dependencyImpact?.layerImpacts ?? []) {
    if (row.status === "ROOT_CAUSE" || row.status === "AFFECTED" || row.status === "DEGRADED") {
      if (validIds.has(row.serviceId)) affected.add(row.serviceId);
    }
  }

  for (const hop of input.diagnosis.dependencyImpact?.propagationPath ?? []) {
    if (hop.status !== "UNAFFECTED" && validIds.has(hop.serviceId)) {
      affected.add(hop.serviceId);
    }
  }

  for (const serviceId of input.incidentServiceIds) {
    if (validIds.has(serviceId)) affected.add(serviceId);
  }

  for (const overlay of buildPropagationOverlays({ topology: input.topology, diagnosis: input.diagnosis })) {
    affected.add(overlay.sourceId);
    affected.add(overlay.targetId);
  }

  const root = input.diagnosis.dependencyImpact?.probableRootCause?.serviceId;
  if (root && validIds.has(root)) affected.add(root);

  return [...affected];
};

export type IncidentCausalGraphBuildInput = {
  incident: {
    id: string;
    projectId: string;
    title: string;
    status: string;
    severity: string;
  };
  topology: ProjectTopologyResponse;
  diagnosis: DeepDiagnosisResult;
  candidates: RootCauseCandidateDto[];
  incidentServiceIds: string[];
  changeEvents: Array<{
    id: string;
    eventType: string;
    summary: string;
    occurredAt: Date;
    serviceId: string | null;
    actor: string | null;
  }>;
  correlatedIncidents: CorrelatedIncidentNodeDto[];
  generatedAt?: Date;
};

export const buildIncidentCausalGraphResponse = (
  input: IncidentCausalGraphBuildInput
): IncidentCausalGraphResponse => {
  const validIds = topologyNodeIds(input.topology);
  const probableRootCauses = buildRootCauseOverlays({
    topology: input.topology,
    diagnosis: input.diagnosis,
    candidates: input.candidates
  });
  const propagationEdges = buildPropagationOverlays({
    topology: input.topology,
    diagnosis: input.diagnosis
  });
  const affectedNodeIds = buildAffectedNodeIds({
    topology: input.topology,
    diagnosis: input.diagnosis,
    incidentServiceIds: input.incidentServiceIds
  });
  const incidentNodeIds = input.incidentServiceIds.filter((id) => validIds.has(id));

  const changeEvents: ChangeEventNodeDto[] = input.changeEvents.map((row) => ({
    id: row.id,
    type: mapChangeEventType(row.eventType),
    title: `${row.eventType}: ${row.summary}`,
    occurredAt: row.occurredAt.toISOString(),
    serviceId: row.serviceId && validIds.has(row.serviceId) ? row.serviceId : row.serviceId,
    actor: row.actor
  }));

  const evidence: CausalEvidenceDto[] = (input.diagnosis.evidence ?? []).map((row) => ({
    type: classifyAnalysisEvidence(row.type, input.diagnosis.analysisMode),
    description: row.summary,
    source: row.type
  }));

  for (const candidate of input.candidates.slice(0, 3)) {
    evidence.push({
      type: classifyCandidateEvidence(candidate, input.diagnosis.analysisMode),
      description: candidate.rationale,
      source: candidate.kind
    });
  }

  return {
    incident: input.incident,
    topology: input.topology,
    overlay: {
      probableRootCauses,
      propagationEdges,
      affectedNodeIds,
      incidentNodeIds,
      changeEvents,
      correlatedIncidents: input.correlatedIncidents
    },
    explanation: {
      summary: input.diagnosis.rootCauseHypothesis ?? input.diagnosis.diagnosis ?? null,
      confidence: input.diagnosis.confidence != null ? Math.round(input.diagnosis.confidence * 100) : null,
      evidence
    },
    generatedAt: (input.generatedAt ?? new Date()).toISOString()
  };
};
