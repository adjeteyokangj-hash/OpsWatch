import { prisma } from "../../lib/prisma";
import { computeConfidence } from "./confidence.service";
import { evaluatePredictionGate } from "./prediction-gate.service";
import {
  MIN_BASELINE_SAMPLES,
  MIN_DISPLAY_CONFIDENCE,
  MIN_RECOMMENDATION_CONFIDENCE,
  PATTERN_TYPE,
  isPredictionsEnabled
} from "./intelligence-constants";
import { buildPhase9IntelligenceSection, type Phase9IntelligenceSection } from "../learning/learning-intelligence.service";
import { listLearningStages } from "../learning/learning-flags";
import { syncDeploymentsFromChangeEvents } from "./deployment-intelligence.service";
import { randomUUID } from "crypto";

const emptyPhase9Section = async (): Promise<Phase9IntelligenceSection> => ({
  learningStages: listLearningStages(),
  metricBaselines: [],
  anomalies: [],
  deterioration: [],
  incidentPatterns: [],
  predictionCandidates: [],
  preventiveRecommendations: [],
  outcomeLearning: {
    evaluated: 0,
    materialised: 0,
    prevented: 0,
    falsePositiveRate: null,
    precision: null,
    note: "Phase 9 section unavailable for this request."
  },
  securityRiskPatterns: []
});

export type IntelligenceSnapshot = {
  learningState: "EMPTY" | "LEARNING" | "ACTIVE";
  predictions: {
    enabled: boolean;
    status: string;
    reason: string;
    productEmission: false | true;
  };
  confidenceGates: {
    minDisplayConfidence: number;
    minRecommendationConfidence: number;
  };
  counters: {
    observations: number;
    baselines: number;
    baselinesReady: number;
    patterns: number;
    patternsDisplayable: number;
    incidentMemories: number;
    deployments: number;
    timelineEvents: number;
    automationRuns: number;
    auditEntries: number;
    predictionAccuracyLogs: number;
  };
  recentTimeline: Array<{
    id: string;
    eventType: string;
    summary: string;
    projectId: string | null;
    severity: string | null;
    occurredAt: string;
  }>;
  patterns: Array<{
    id: string;
    patternType: string;
    title: string;
    description: string;
    evidenceCount: number;
    confidenceScore: number;
    displayEligible: boolean;
    lastMatchedAt: string | null;
  }>;
  baselines: Array<{
    id: string;
    scopeType: string;
    scopeKey: string;
    sampleCount: number;
    ready: boolean;
    lastSampleAt: string | null;
  }>;
  deployments: Array<{
    id: string;
    projectId: string | null;
    summary: string;
    deployedAt: string;
    version: string | null;
    commitSha: string | null;
    branch: string | null;
    resultingIncidentCount: number;
    resultingAlertCount: number;
  }>;
  automationHistory: Array<{
    id: string;
    incidentId: string;
    projectId: string;
    status: string;
    triggerType: string | null;
    reason: string | null;
    confidence: number | null;
    durationMs: number | null;
    verificationStatus: string | null;
    success: boolean | null;
    createdAt: string;
  }>;
  incidentMemories: Array<{
    id: string;
    incidentId: string;
    title: string;
    rootCause: string | null;
    automationInvolved: boolean;
    resolutionTimeMs: number | null;
    resolvedAt: string | null;
  }>;
  predictionReadiness: {
    message: string;
    candidatesStored: number;
    accuracyLogs: number;
  };
  phase9: Phase9IntelligenceSection;
  emptyReason: string | null;
};

const countJsonArray = (value: unknown): number =>
  Array.isArray(value) ? value.length : 0;

/**
 * Derive lightweight learning signals from existing operational tables
 * without inventing incidents/predictions. Safe to call on Intelligence page load.
 */
const harvestEvidenceFromOperationalData = async (
  organizationId: string
): Promise<void> => {
  const projects = await prisma.project.findMany({
    where: { organizationId, isActive: true },
    select: { id: true },
    take: 50
  });
  const projectIds = projects.map((row) => row.id);
  if (projectIds.length === 0) return;

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const [alertGroups, checkAgg] = await Promise.all([
    prisma.alert.groupBy({
      by: ["title", "projectId"],
      where: {
        projectId: { in: projectIds },
        firstSeenAt: { gte: since }
      },
      _count: { _all: true }
    }),
    prisma.checkResult.groupBy({
      by: ["status"],
      where: {
        checkedAt: { gte: since },
        Check: { Service: { projectId: { in: projectIds } } }
      },
      _count: { _all: true },
      _avg: { responseTimeMs: true }
    })
  ]);

  for (const group of alertGroups) {
    if (group._count._all < 2) continue;
    const signatureKey = `alert:${group.projectId}:${group.title}`.slice(0, 200);
    const confidence = computeConfidence({
      evidenceCount: group._count._all,
      dataCompleteness: Math.min(1, group._count._all / 10)
    });
    const existing = await prisma.operationalPattern.findUnique({
      where: {
        organizationId_patternType_signatureKey: {
          organizationId,
          patternType: PATTERN_TYPE.REPEATED_FAILURE,
          signatureKey
        }
      }
    });
    const now = new Date();
    if (!existing) {
      await prisma.operationalPattern.create({
        data: {
          id: randomUUID(),
          organizationId,
          projectId: group.projectId,
          patternType: PATTERN_TYPE.REPEATED_FAILURE,
          signatureKey,
          title: `Repeated alert: ${group.title}`,
          description: `Observed ${group._count._all} occurrences of this alert in the last 14 days.`,
          evidenceCount: group._count._all,
          confidenceScore: confidence.score,
          evidenceJson: { alertTitle: group.title, count: group._count._all },
          lastMatchedAt: now,
          displayEligible: confidence.displayEligible,
          updatedAt: now
        }
      });
    } else if (existing.evidenceCount !== group._count._all) {
      await prisma.operationalPattern.update({
        where: { id: existing.id },
        data: {
          evidenceCount: group._count._all,
          confidenceScore: confidence.score,
          displayEligible: confidence.displayEligible,
          description: `Observed ${group._count._all} occurrences of this alert in the last 14 days.`,
          lastMatchedAt: now,
          updatedAt: now
        }
      });
    }
  }

  const passCount =
    checkAgg.find((row) => row.status === "PASS")?._count._all ?? 0;
  const failCount =
    checkAgg.find((row) => row.status === "FAIL")?._count._all ?? 0;
  const avgLatency = checkAgg.find((row) => row.status === "PASS")?._avg
    .responseTimeMs;
  if (passCount + failCount > 0) {
    const existing = await prisma.learningBaseline.findUnique({
      where: {
        organizationId_projectId_scopeType_scopeKey: {
          organizationId,
          projectId: "",
          scopeType: "RESPONSE_TIME",
          scopeKey: "org_checks"
        }
      }
    });
    const now = new Date();
    const metrics = {
      passCount,
      failCount,
      avgLatencyMs: avgLatency ?? null
    };
    if (!existing) {
      await prisma.learningBaseline.create({
        data: {
          id: randomUUID(),
          organizationId,
          projectId: "",
          scopeType: "RESPONSE_TIME",
          scopeKey: "org_checks",
          sampleCount: passCount + failCount,
          metricsJson: metrics,
          lastSampleAt: now,
          updatedAt: now
        }
      });
    } else {
      await prisma.learningBaseline.update({
        where: { id: existing.id },
        data: {
          sampleCount: Math.max(existing.sampleCount, passCount + failCount),
          metricsJson: metrics,
          lastSampleAt: now,
          updatedAt: now
        }
      });
    }

    const trafficExisting = await prisma.learningBaseline.findUnique({
      where: {
        organizationId_projectId_scopeType_scopeKey: {
          organizationId,
          projectId: "",
          scopeType: "TRAFFIC",
          scopeKey: "org_check_volume"
        }
      }
    });
    const trafficMetrics = { totalChecks: passCount + failCount };
    if (!trafficExisting) {
      await prisma.learningBaseline.create({
        data: {
          id: randomUUID(),
          organizationId,
          projectId: "",
          scopeType: "TRAFFIC",
          scopeKey: "org_check_volume",
          sampleCount: passCount + failCount,
          metricsJson: trafficMetrics,
          lastSampleAt: now,
          updatedAt: now
        }
      });
    } else {
      await prisma.learningBaseline.update({
        where: { id: trafficExisting.id },
        data: {
          sampleCount: Math.max(trafficExisting.sampleCount, passCount + failCount),
          metricsJson: trafficMetrics,
          lastSampleAt: now,
          updatedAt: now
        }
      });
    }
  }

  await syncDeploymentsFromChangeEvents(organizationId, 25);
};

export const buildIntelligenceSnapshot = async (
  organizationId: string,
  options?: { harvest?: boolean }
): Promise<IntelligenceSnapshot> => {
  if (options?.harvest !== false) {
    try {
      await harvestEvidenceFromOperationalData(organizationId);
    } catch {
      // Harvest is best-effort; snapshot still returns stored facts.
    }
  }

  // Keep snapshot reads sequential to avoid local Postgres connection storms.
  const observations = await prisma.operationalObservation.count({ where: { organizationId } });
  const baselines = await prisma.learningBaseline.count({ where: { organizationId } });
  const patterns = await prisma.operationalPattern.count({ where: { organizationId } });
  const incidentMemories = await prisma.incidentMemoryEntry.count({ where: { organizationId } });
  const deployments = await prisma.deploymentRecord.count({ where: { organizationId } });
  const timelineEvents = await prisma.operationsTimelineEvent.count({ where: { organizationId } });
  const automationRuns = await prisma.automationRun.count({ where: { organizationId } });
  const auditEntries = await prisma.aiDecisionAudit.count({ where: { organizationId } });
  const predictionAccuracyLogs = await prisma.predictionAccuracyLog.count({
    where: { organizationId }
  });
  const recentTimeline = await prisma.operationsTimelineEvent.findMany({
    where: { organizationId },
    orderBy: { occurredAt: "desc" },
    take: 40
  });
  const patternRows = await prisma.operationalPattern.findMany({
    where: { organizationId },
    orderBy: [{ displayEligible: "desc" }, { confidenceScore: "desc" }],
    take: 30
  });
  const baselineRows = await prisma.learningBaseline.findMany({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
    take: 30
  });
  const deploymentRows = await prisma.deploymentRecord.findMany({
    where: { organizationId },
    orderBy: { deployedAt: "desc" },
    take: 20
  });
  const automationRows = await prisma.automationRun.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { Outcomes: { orderBy: { createdAt: "desc" }, take: 1 } }
  });
  const memoryRows = await prisma.incidentMemoryEntry.findMany({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
    take: 20
  });

  const baselinesReady = baselineRows.filter(
    (row) => row.sampleCount >= MIN_BASELINE_SAMPLES
  ).length;
  const patternsDisplayable = patternRows.filter((row) => row.displayEligible)
    .length;

  const orgConfidence = computeConfidence({
    evidenceCount: observations + patterns + incidentMemories,
    dataCompleteness: Math.min(
      1,
      (baselinesReady + patternsDisplayable + incidentMemories) / 10
    ),
    matchingIncidents: incidentMemories,
    recoveryMatches: baselinesReady
  });
  const predictionGate = evaluatePredictionGate(orgConfidence);

  const totalSignals =
    observations +
    baselines +
    patterns +
    incidentMemories +
    deployments +
    timelineEvents +
    automationRuns;

  let learningState: IntelligenceSnapshot["learningState"] = "EMPTY";
  if (totalSignals === 0) learningState = "EMPTY";
  else if (baselinesReady > 0 || patternsDisplayable > 0 || incidentMemories > 0)
    learningState = "ACTIVE";
  else learningState = "LEARNING";

  let phase9;
  try {
    phase9 = await buildPhase9IntelligenceSection(organizationId);
  } catch {
    phase9 = await emptyPhase9Section();
  }
  const stages = listLearningStages();
  const enabledStageLabels = stages.filter((s) => s.enabled).map((s) => s.key);

  return {
    learningState,
    predictions: {
      enabled: isPredictionsEnabled(),
      status: predictionGate.status,
      reason: predictionGate.reason,
      productEmission: predictionGate.emitToProduct
    },
    confidenceGates: {
      minDisplayConfidence: MIN_DISPLAY_CONFIDENCE,
      minRecommendationConfidence: MIN_RECOMMENDATION_CONFIDENCE
    },
    counters: {
      observations,
      baselines,
      baselinesReady,
      patterns,
      patternsDisplayable,
      incidentMemories,
      deployments,
      timelineEvents,
      automationRuns,
      auditEntries,
      predictionAccuracyLogs
    },
    recentTimeline: recentTimeline.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      summary: row.summary,
      projectId: row.projectId,
      severity: row.severity,
      occurredAt: row.occurredAt.toISOString()
    })),
    patterns: patternRows.map((row) => ({
      id: row.id,
      patternType: row.patternType,
      title: row.title,
      description: row.description,
      evidenceCount: row.evidenceCount,
      confidenceScore: row.confidenceScore,
      displayEligible: row.displayEligible,
      lastMatchedAt: row.lastMatchedAt?.toISOString() ?? null
    })),
    baselines: baselineRows.map((row) => ({
      id: row.id,
      scopeType: row.scopeType,
      scopeKey: row.scopeKey,
      sampleCount: row.sampleCount,
      ready: row.sampleCount >= MIN_BASELINE_SAMPLES,
      lastSampleAt: row.lastSampleAt?.toISOString() ?? null
    })),
    deployments: deploymentRows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      summary: row.summary,
      deployedAt: row.deployedAt.toISOString(),
      version: row.version,
      commitSha: row.commitSha,
      branch: row.branch,
      resultingIncidentCount: countJsonArray(row.resultingIncidentIds),
      resultingAlertCount: countJsonArray(row.resultingAlertIds)
    })),
    automationHistory: automationRows.map((row) => ({
      id: row.id,
      incidentId: row.incidentId,
      projectId: row.projectId,
      status: row.status,
      triggerType: row.triggerType,
      reason: row.reason,
      confidence: row.confidence,
      durationMs: row.durationMs,
      verificationStatus: row.verificationStatus,
      success: row.Outcomes[0]?.success ?? null,
      createdAt: row.createdAt.toISOString()
    })),
    incidentMemories: memoryRows.map((row) => ({
      id: row.id,
      incidentId: row.incidentId,
      title: row.title,
      rootCause: row.rootCause,
      automationInvolved: row.automationInvolved,
      resolutionTimeMs: row.resolutionTimeMs,
      resolvedAt: row.resolvedAt?.toISOString() ?? null
    })),
    predictionReadiness: {
      message: isPredictionsEnabled()
        ? `Prediction generation is enabled. Stages on: ${enabledStageLabels.join(", ") || "none"}. High-impact candidates require human review.`
        : `Prediction generation is OFF by default. Enabled learning stages: ${enabledStageLabels.join(", ") || "none"}. No silent prediction generation.`,
      candidatesStored: phase9.predictionCandidates.length,
      accuracyLogs: predictionAccuracyLogs
    },
    phase9,
    emptyReason:
      learningState === "EMPTY"
        ? "No operational evidence yet. Heartbeats, checks, alerts, incidents, and deployments will build intelligence automatically."
        : learningState === "LEARNING"
          ? "Collecting baselines and patterns. Actionable insights appear only after confidence thresholds are met."
          : null
  };
};
