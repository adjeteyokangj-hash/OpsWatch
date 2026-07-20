import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { computeConfidence } from "../intelligence/confidence.service";
import {
  ALGORITHM,
  CONFIDENCE_LEVEL,
  DATA_QUALITY,
  isLearningStageEnabled,
  isPredictionGenerationEnabled,
  listLearningStages,
  MIN_BASELINE_SAMPLES_PHASE9,
  PREDICTION_REVIEW_STATE
} from "./learning-flags";
import { confidenceFromSamples } from "./learning-stats";
import { getUniversalAction } from "../remediation/action-registry";

const DEFAULT_HORIZON_MS = 24 * 60 * 60 * 1000;
const SSL_HORIZON_MS = 14 * 24 * 60 * 60 * 1000;

export type PredictionCycleResult = {
  skipped: boolean;
  reason?: string;
  created: number;
  candidates: string[];
};

/**
 * Create evidence-backed prediction candidates for *future* operational risk.
 * Default OFF. Every candidate requires evidence JSON and expiry.
 */
export const generatePredictionCandidates = async (
  organizationId: string
): Promise<PredictionCycleResult> => {
  if (!isPredictionGenerationEnabled()) {
    return {
      skipped: true,
      reason: "PREDICTION_CANDIDATES disabled (default). No silent generation.",
      created: 0,
      candidates: []
    };
  }

  const stages = listLearningStages();
  const now = new Date();
  const createdIds: string[] = [];

  // SSL expiry disruption risk from certificate checks with near-term expiry evidence.
  const sslCandidates = await buildSslExpiryCandidates(organizationId, now, stages);
  createdIds.push(...sslCandidates);

  // Recurring incident risk after similar deployment context + pattern memory.
  const recurrenceCandidates = await buildRecurrenceCandidates(organizationId, now, stages);
  createdIds.push(...recurrenceCandidates);

  // SLO / latency breach horizon from deterioration + strong baseline.
  const sloCandidates = await buildSloBreachCandidates(organizationId, now, stages);
  createdIds.push(...sloCandidates);

  return { skipped: false, created: createdIds.length, candidates: createdIds };
};

const buildSslExpiryCandidates = async (
  organizationId: string,
  now: Date,
  stages: ReturnType<typeof listLearningStages>
): Promise<string[]> => {
  const ids: string[] = [];
  // Look for recent SSL check failures/warnings mentioning expiry in message.
  const results = await prisma.checkResult.findMany({
    where: {
      Check: {
        type: "SSL",
        Service: { Project: { organizationId } }
      },
      checkedAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
      OR: [
        { message: { contains: "expir", mode: "insensitive" } },
        { status: "WARN" },
        { status: "FAIL" }
      ]
    },
    include: {
      Check: {
        include: {
          Service: { select: { projectId: true, id: true, name: true } }
        }
      }
    },
    take: 50,
    orderBy: { checkedAt: "desc" }
  });

  for (const row of results) {
    const projectId = row.Check.Service.projectId;
    const evidence = {
      checkId: row.checkId,
      checkResultId: row.id,
      status: row.status,
      message: row.message,
      checkedAt: row.checkedAt.toISOString(),
      serviceId: row.Check.Service.id,
      serviceName: row.Check.Service.name
    };
    const conf = confidenceFromSamples(8, 0.7);
    if (conf.label === CONFIDENCE_LEVEL.INSUFFICIENT) continue;

    const id = await persistCandidate({
      organizationId,
      projectId,
      predictionType: "SSL_EXPIRY_OUTAGE_RISK",
      title: "Elevated SSL expiry disruption risk",
      summary:
        "Certificate check evidence indicates elevated risk of HTTPS disruption within the forecast horizon. Not a guaranteed outage.",
      confidenceScore: conf.score,
      confidenceLabel: conf.label,
      forecastHorizonMs: SSL_HORIZON_MS,
      probability: Math.min(0.85, conf.score),
      evidence,
      recommendedAction: "RERUN_SSL_CHECK",
      now,
      stages
    });
    if (id) ids.push(id);
  }
  return ids;
};

const buildRecurrenceCandidates = async (
  organizationId: string,
  now: Date,
  stages: ReturnType<typeof listLearningStages>
): Promise<string[]> => {
  if (!isLearningStageEnabled("INCIDENT_MATCHING")) return [];

  const patterns = await prisma.incidentPatternMemory.findMany({
    where: {
      organizationId,
      displayEligible: true,
      recurrenceCount: { gte: 2 },
      dataQualityState: DATA_QUALITY.LIVE
    },
    take: 30
  });

  const ids: string[] = [];
  for (const pattern of patterns) {
    const recentDeploy = await prisma.deploymentRecord.findFirst({
      where: {
        organizationId,
        projectId: pattern.projectId ?? undefined,
        deployedAt: { gte: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) }
      },
      orderBy: { deployedAt: "desc" }
    });
    if (!recentDeploy) continue;

    const conf = computeConfidence({
      evidenceCount: pattern.recurrenceCount + 5,
      dataCompleteness: 0.8,
      matchingIncidents: pattern.recurrenceCount,
      recoveryMatches: Array.isArray(pattern.successfulActionKeysJson)
        ? pattern.successfulActionKeysJson.length
        : 0
    });
    if (!conf.displayEligible || conf.score < 0.55) continue;

    const id = await persistCandidate({
      organizationId,
      projectId: pattern.projectId,
      predictionType: "INCIDENT_RECURRENCE_RISK",
      title: "Elevated incident recurrence risk after similar deployment",
      summary: `Pattern "${pattern.title}" has recurred ${pattern.recurrenceCount} times. A recent deployment increases recurrence risk. Similarity ≠ same cause.`,
      confidenceScore: conf.score,
      confidenceLabel: conf.label,
      forecastHorizonMs: DEFAULT_HORIZON_MS,
      probability: conf.score * 0.9,
      evidence: {
        patternId: pattern.id,
        fingerprint: pattern.fingerprint,
        recurrenceCount: pattern.recurrenceCount,
        deploymentId: recentDeploy.id,
        deployedAt: recentDeploy.deployedAt.toISOString(),
        calculatedEvidence: true
      },
      recommendedAction: "REQUEST_HUMAN_REVIEW",
      relatedIncidentId: Array.isArray(pattern.sourceIncidentIdsJson)
        ? (pattern.sourceIncidentIdsJson[0] as string)
        : null,
      now,
      stages
    });
    if (id) ids.push(id);
  }
  return ids;
};

const buildSloBreachCandidates = async (
  organizationId: string,
  now: Date,
  stages: ReturnType<typeof listLearningStages>
): Promise<string[]> => {
  const baselines = await prisma.metricBaseline.findMany({
    where: {
      organizationId,
      metricKey: { in: ["error_rate", "p95_latency_ms"] },
      sampleCount: { gte: MIN_BASELINE_SAMPLES_PHASE9 },
      dataQualityState: DATA_QUALITY.LIVE,
      confidenceLabel: { in: [CONFIDENCE_LEVEL.MODERATE, CONFIDENCE_LEVEL.HIGH] }
    },
    take: 40
  });

  const ids: string[] = [];
  for (const baseline of baselines) {
    if (baseline.mean == null || !baseline.projectId) continue;
    const recent = await prisma.apmServiceWindow.findMany({
      where: {
        organizationId,
        projectId: baseline.projectId,
        windowEnd: { gte: new Date(now.getTime() - 6 * 60 * 60 * 1000) }
      },
      orderBy: { windowEnd: "desc" },
      take: 6
    });
    if (recent.length < 3) continue;

    const series =
      baseline.metricKey === "error_rate"
        ? recent.map((row) => row.errorRate)
        : recent
            .map((row) => row.latencyP95Ms)
            .filter((value): value is number => typeof value === "number");
    if (series.length < 3) continue;

    const latest = series[0]!;
    const threshold =
      baseline.metricKey === "error_rate"
        ? Math.max(baseline.mean * 1.5, (baseline.p95 ?? baseline.mean) * 1.1)
        : Math.max(baseline.mean * 1.4, baseline.p95 ?? baseline.mean);

    // Future risk: trending toward threshold but not necessarily breached yet.
    if (!(latest < threshold && latest > baseline.mean * 1.15)) continue;

    const conf = confidenceFromSamples(baseline.sampleCount, 0.75);
    if (conf.label === CONFIDENCE_LEVEL.INSUFFICIENT) continue;

    const id = await persistCandidate({
      organizationId,
      projectId: baseline.projectId,
      predictionType: "LIKELY_SLO_BREACH",
      title: `Likely ${baseline.metricKey} SLO pressure within horizon`,
      summary: `Observed ${latest.toFixed(3)} trending above baseline mean ${baseline.mean.toFixed(3)} toward threshold ${threshold.toFixed(3)}. Evidence-backed risk candidate — not a guaranteed breach.`,
      confidenceScore: conf.score,
      confidenceLabel: conf.label,
      forecastHorizonMs: DEFAULT_HORIZON_MS,
      probability: Math.min(0.8, conf.score * 0.95),
      evidence: {
        baselineId: baseline.id,
        metricKey: baseline.metricKey,
        observed: latest,
        baselineMean: baseline.mean,
        threshold,
        sampleCount: baseline.sampleCount,
        windowCount: series.length
      },
      recommendedAction: "RERUN_HTTP_CHECK",
      now,
      stages
    });
    if (id) ids.push(id);
  }
  return ids;
};

const persistCandidate = async (input: {
  organizationId: string;
  projectId?: string | null;
  predictionType: string;
  title: string;
  summary: string;
  confidenceScore: number;
  confidenceLabel: string;
  forecastHorizonMs: number;
  probability: number;
  evidence: Record<string, unknown>;
  recommendedAction?: string;
  relatedIncidentId?: string | null;
  now: Date;
  stages: ReturnType<typeof listLearningStages>;
}): Promise<string | null> => {
  if (!input.evidence || Object.keys(input.evidence).length === 0) return null;

  let recommendedAction = input.recommendedAction ?? null;
  if (recommendedAction) {
    const action = getUniversalAction(recommendedAction);
    if (!action || action.riskLevel === "HIGH" || action.riskLevel === "CRITICAL") {
      // Only low/medium governed actions; fall back to notify/review.
      recommendedAction = "REQUEST_HUMAN_REVIEW";
    }
  }

  const expiresAt = new Date(input.now.getTime() + input.forecastHorizonMs);
  const id = randomUUID();

  // Avoid duplicates of same type+project still open.
  const existing = await prisma.predictionCandidate.findFirst({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      predictionType: input.predictionType,
      reviewState: {
        in: [
          PREDICTION_REVIEW_STATE.DRAFT,
          PREDICTION_REVIEW_STATE.NEEDS_REVIEW,
          PREDICTION_REVIEW_STATE.CONFIRMED
        ]
      },
      expiresAt: { gt: input.now }
    }
  });
  if (existing) return null;

  const highImpact = input.confidenceScore >= 0.75 || input.probability >= 0.7;

  await prisma.predictionCandidate.create({
    data: {
      id,
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      predictionType: input.predictionType,
      title: input.title,
      summary: input.summary,
      confidenceScore: input.confidenceScore,
      confidenceLabel: input.confidenceLabel === "MEDIUM" ? "MODERATE" : input.confidenceLabel,
      status: "READY",
      reviewState: highImpact
        ? PREDICTION_REVIEW_STATE.NEEDS_REVIEW
        : PREDICTION_REVIEW_STATE.DRAFT,
      forecastHorizonMs: input.forecastHorizonMs,
      probability: input.probability,
      ruleName: ALGORITHM.PREDICTION,
      ruleVersion: 1,
      algorithmVersion: ALGORITHM.PREDICTION,
      dataQualityState: DATA_QUALITY.LIVE,
      recommendedAction,
      relatedIncidentId: input.relatedIncidentId ?? null,
      evidenceJson: input.evidence as Prisma.InputJsonValue,
      explanationJson: {
        calculatedEvidence: input.evidence,
        generatedExplanation: input.summary,
        labels: ["Calculated evidence", "Generated explanation"]
      } as Prisma.InputJsonValue,
      featureFlagsJson: input.stages as unknown as Prisma.InputJsonValue,
      computedAt: input.now,
      expiresAt,
      retentionExpiresAt: new Date(input.now.getTime() + 90 * 24 * 60 * 60 * 1000),
      updatedAt: input.now
    }
  });

  return id;
};
