import { prisma } from "../../lib/prisma";
import { loadProjectTopology } from "../topology-loader.service";
import type { ProjectTopologyResponse } from "../../types/dto";
import { findSimilarIncidents } from "./incident-memory.service";
import type { IncidentAnalysisContext } from "./incident-analysis.service";

export type RelationshipIncidentMemoryMatch = {
  incidentId: string;
  title: string;
  similarity: number;
  resolvedAt: string | null;
  resolutionTimeMs: number | null;
  lastFixSuccess: boolean | null;
};

export type RelationshipIncidentMemorySignals = {
  occurrenceCount: number | null;
  frequencyPer30Days: number | null;
  averagePatternSimilarity: number | null;
  mttrMs: number | null;
  predictedNextOccurrenceAt: string | null;
  previousFixCount: number | null;
  successRate: number | null;
  matches: RelationshipIncidentMemoryMatch[];
};

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

const safeMedian = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
};

const safeAvg = (values: number[]): number | null => {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
};

const toMs = (date: Date | string): number => {
  const dt = typeof date === "string" ? new Date(date) : date;
  const ms = dt.getTime();
  return Number.isNaN(ms) ? 0 : ms;
};

const computeFrequencyPer30Days = (resolvedAtIso: string[], occurrenceCount: number): number | null => {
  const times = resolvedAtIso.map(toMs).filter((ms) => ms > 0).sort((a, b) => a - b);
  if (times.length < 2) return null;
  const days = (times[times.length - 1]! - times[0]!) / (24 * 60 * 60 * 1000);
  if (!Number.isFinite(days) || days <= 0) return null;
  return (occurrenceCount / days) * 30;
};

const computePredictedNextOccurrenceAt = (resolvedAtIso: string[]): string | null => {
  const times = resolvedAtIso.map(toMs).filter((ms) => ms > 0).sort((a, b) => a - b);
  if (times.length < 2) return null;
  const diffs: number[] = [];
  for (let i = 1; i < times.length; i += 1) diffs.push(times[i]! - times[i - 1]!);
  const avgIntervalMs = safeAvg(diffs);
  if (avgIntervalMs == null || !Number.isFinite(avgIntervalMs) || avgIntervalMs <= 0) return null;
  return new Date(times[times.length - 1]! + avgIntervalMs).toISOString();
};

const buildEdgeContextForSimilarity = (input: {
  topology: ProjectTopologyResponse;
  edge: ProjectTopologyResponse["edges"][number];
}): {
  title: string;
  diagnosisSummary: string;
  alerts: IncidentAnalysisContext["alerts"];
} => {
  const sourceNode = input.topology.nodes.find((n) => n.id === input.edge.sourceId);
  const targetNode = input.topology.nodes.find((n) => n.id === input.edge.targetId);
  const sourceName = sourceNode?.name ?? input.edge.sourceId;
  const targetName = targetNode?.name ?? input.edge.targetId;

  const sourceCtx = input.topology.nodeContext[input.edge.sourceId];
  const targetCtx = input.topology.nodeContext[input.edge.targetId];

  const alerts = [...(sourceCtx?.openAlerts ?? []), ...(targetCtx?.openAlerts ?? [])].slice(0, 10);

  const lastFailureLabel =
    sourceCtx?.lastCheckStatus === "FAIL" || targetCtx?.lastCheckStatus === "FAIL"
      ? "Observed check failure on relationship endpoints"
      : input.edge.status === "CRITICAL"
        ? "Critical relationship health"
        : input.edge.status === "DEGRADED"
          ? "Degraded relationship health"
          : "Relationship health signals indicate incident similarity";

  return {
    title: `${sourceName} -> ${targetName}`,
    diagnosisSummary: lastFailureLabel,
    alerts: alerts.map((a) => ({
      id: a.id,
      title: a.title,
      message: a.title,
      severity: a.severity,
      status: a.status,
      sourceType: "ALERT",
      category: a.severity,
      serviceId: null,
      sourceId: null
    }))
  };
};

export const getRelationshipIncidentMemorySignals = async (input: {
  organizationId: string;
  projectId: string;
  edgeId: string;
}): Promise<RelationshipIncidentMemorySignals | null> => {
  const topology = await loadProjectTopology(input.organizationId, input.projectId);
  if (!topology) return null;

  const edge = topology.edges.find((row) => row.id === input.edgeId);
  if (!edge) return null;
  if (edge.type === "HIERARCHY") return null;

  const edgeCtx = buildEdgeContextForSimilarity({ topology, edge });

  // `findSimilarIncidents` needs title + alerts + timeline to build an incident signature.
  const similarityContext = {
    incidentId: edge.id,
    title: edgeCtx.title,
    severity: edge.status,
    status: edge.status,
    projectId: input.projectId,
    openedAt: new Date(topology.generatedAt),
    alerts: edgeCtx.alerts,
    timeline: [],
    candidates: [],
    sloBreaches: [],
    projectName: topology.project.name,
    services: [],
    dependencyEdges: [],
    failingServiceIds: [],
    checkFailures: []
  } as unknown as IncidentAnalysisContext;

  const matches = await findSimilarIncidents({
    organizationId: input.organizationId,
    context: similarityContext,
    diagnosisSummary: edgeCtx.diagnosisSummary,
    limit: 12
  });

  if (matches.length === 0) return null;

  const occurrenceCount = matches.length;
  const resolvedAtIso = matches.map((m) => m.resolvedAt).filter((v): v is string => typeof v === "string");
  const averagePatternSimilarity = safeAvg(matches.map((m) => m.similarity));
  const frequencyPer30Days = computeFrequencyPer30Days(resolvedAtIso, occurrenceCount);
  const predictedNextOccurrenceAt = computePredictedNextOccurrenceAt(resolvedAtIso);

  const incidentIds = matches.map((m) => m.incidentId);
  const memoryRows = await prisma.incidentMemoryEntry.findMany({
    where: { organizationId: input.organizationId, incidentId: { in: incidentIds } },
    select: { incidentId: true, resolutionTimeMs: true, resolvedAt: true }
  });

  const resolutionByIncidentId = new Map(
    memoryRows.map((row) => [
      row.incidentId,
      {
        resolutionTimeMs: row.resolutionTimeMs,
        resolvedAt: row.resolvedAt?.toISOString() ?? null
      }
    ])
  );

  const mttrMs = safeMedian(memoryRows.map((row) => row.resolutionTimeMs).filter((v): v is number => typeof v === "number"));

  const endpointIds = new Set([edge.sourceId, edge.targetId]);
  const automationRuns = await prisma.automationRun.findMany({
    where: { organizationId: input.organizationId, incidentId: { in: incidentIds } },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      Outcomes: { orderBy: { createdAt: "desc" }, take: 1 },
      Steps: { select: { targetServiceId: true } }
    }
  });

  const relevantRuns = automationRuns.filter((run) => {
    const affected = asStringArray(run.affectedServiceIds);
    const targets = asStringArray(run.Steps.map((step) => step.targetServiceId));
    return affected.some((id) => endpointIds.has(id)) || targets.some((id) => endpointIds.has(id));
  });

  const lastOutcomeByIncidentId = new Map<string, { success: boolean | null }>();
  for (const run of relevantRuns) {
    const latestOutcome = run.Outcomes[0];
    const success = typeof latestOutcome?.success === "boolean" ? latestOutcome.success : null;
    // relevantRuns are ordered desc by createdAt, so first seen is the latest.
    if (!lastOutcomeByIncidentId.has(run.incidentId)) {
      lastOutcomeByIncidentId.set(run.incidentId, { success });
    }
  }

  const knownOutcomeRuns = relevantRuns.filter((run) => typeof run.Outcomes[0]?.success === "boolean");
  const successCount = knownOutcomeRuns.filter((run) => run.Outcomes[0]?.success === true).length;

  const previousFixCount = relevantRuns.length === 0 ? null : relevantRuns.length;
  const successRate = knownOutcomeRuns.length > 0 ? successCount / knownOutcomeRuns.length : null;

  const matchesWithEvidence: RelationshipIncidentMemoryMatch[] = matches
    .map((m) => {
      const memoryRow = resolutionByIncidentId.get(m.incidentId);
      const lastOutcome = lastOutcomeByIncidentId.get(m.incidentId);
      return {
        incidentId: m.incidentId,
        title: m.title,
        similarity: m.similarity,
        resolvedAt: memoryRow?.resolvedAt ?? m.resolvedAt,
        resolutionTimeMs: memoryRow?.resolutionTimeMs ?? null,
        lastFixSuccess: lastOutcome?.success ?? null
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);

  return {
    occurrenceCount,
    frequencyPer30Days,
    averagePatternSimilarity: averagePatternSimilarity == null ? null : clamp01(averagePatternSimilarity),
    mttrMs,
    predictedNextOccurrenceAt,
    previousFixCount,
    successRate: successRate == null ? null : clamp01(successRate),
    matches: matchesWithEvidence
  };
};

