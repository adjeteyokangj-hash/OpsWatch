import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  ALGORITHM,
  DATA_QUALITY,
  isLearningStageEnabled,
  MIN_BASELINE_SAMPLES_PHASE9
} from "./learning-flags";
import { CONFIDENCE_LEVEL } from "./learning-flags";

export type AnomalyDetectionResult = {
  skipped: boolean;
  reason?: string;
  created: number;
  updated: number;
};

const STALE_MS = 6 * 60 * 60 * 1000;

/**
 * Deterministic anomaly detection against MetricBaseline.
 * Labels observations as anomalies / above normal — not predictions.
 */
export const detectAnomaliesForOrg = async (
  organizationId: string
): Promise<AnomalyDetectionResult> => {
  if (!isLearningStageEnabled("ANOMALY_DETECTION")) {
    return { skipped: true, reason: "ANOMALY_DETECTION disabled", created: 0, updated: 0 };
  }

  const baselines = await prisma.metricBaseline.findMany({
    where: {
      organizationId,
      dataQualityState: { notIn: [DATA_QUALITY.TEST_EXCLUDED, DATA_QUALITY.FIXTURE_EXCLUDED] },
      sampleCount: { gte: MIN_BASELINE_SAMPLES_PHASE9 },
      confidenceLabel: { not: CONFIDENCE_LEVEL.INSUFFICIENT }
    },
    take: 200
  });

  let created = 0;
  let updated = 0;
  const now = new Date();

  for (const baseline of baselines) {
    if (!baseline.projectId || baseline.mean == null) continue;

    const observed = await latestObservedValue({
      organizationId,
      projectId: baseline.projectId,
      metricKey: baseline.metricKey
    });
    if (observed == null) continue;

    const detections = evaluateAnomalyMethods({
      baselineMean: baseline.mean,
      baselineP95: baseline.p95,
      variance: baseline.variance,
      observed: observed.value,
      sampleCount: baseline.sampleCount
    });

    for (const detection of detections) {
      const existing = await prisma.anomalyRecord.findFirst({
        where: {
          organizationId,
          projectId: baseline.projectId,
          metricKey: baseline.metricKey,
          method: detection.method,
          status: "OPEN"
        },
        orderBy: { lastDetectedAt: "desc" }
      });

      const related = await relatedOpsContext(organizationId, baseline.projectId);
      const payload = {
        expectedMin: detection.expectedMin,
        expectedMax: detection.expectedMax,
        observedValue: observed.value,
        deviation: detection.deviation,
        durationMs: existing
          ? Math.max(0, now.getTime() - existing.firstDetectedAt.getTime())
          : 0,
        sampleCount: baseline.sampleCount,
        baselineConfidence: baseline.confidence,
        baselineId: baseline.id,
        explanation: detection.explanation,
        severity: detection.severity,
        relatedChangeIdsJson: related.changeIds as Prisma.InputJsonValue,
        relatedAlertIdsJson: related.alertIds as Prisma.InputJsonValue,
        relatedIncidentIdsJson: related.incidentIds as Prisma.InputJsonValue,
        dataQualityState: baseline.dataQualityState,
        algorithmVersion: ALGORITHM.ANOMALY,
        lastDetectedAt: now,
        updatedAt: now
      };

      if (existing) {
        await prisma.anomalyRecord.update({ where: { id: existing.id }, data: payload });
        updated += 1;
      } else {
        await prisma.anomalyRecord.create({
          data: {
            id: randomUUID(),
            organizationId,
            projectId: baseline.projectId,
            environment: baseline.environment,
            entityId: baseline.entityId,
            relationshipId: baseline.relationshipId,
            metricKey: baseline.metricKey,
            method: detection.method,
            firstDetectedAt: now,
            ...payload
          }
        });
        created += 1;
      }
    }
  }

  return { skipped: false, created, updated };
};

export const evaluateAnomalyMethods = (input: {
  baselineMean: number;
  baselineP95: number | null;
  variance: number | null;
  observed: number;
  sampleCount: number;
}): Array<{
  method: string;
  expectedMin: number;
  expectedMax: number;
  deviation: number;
  severity: string;
  explanation: string;
}> => {
  const results: Array<{
    method: string;
    expectedMin: number;
    expectedMax: number;
    deviation: number;
    severity: string;
    explanation: string;
  }> = [];

  const std =
    input.variance != null && Number.isFinite(input.variance)
      ? Math.sqrt(Math.max(0, input.variance))
      : Math.abs(input.baselineMean) * 0.2;
  const rollingMin = input.baselineMean - 2 * std;
  const rollingMax = input.baselineMean + 2 * std;

  if (input.observed > rollingMax || input.observed < rollingMin) {
    const deviation = input.observed - input.baselineMean;
    results.push({
      method: "ROLLING_DEVIATION",
      expectedMin: rollingMin,
      expectedMax: rollingMax,
      deviation,
      severity: Math.abs(deviation) > 3 * std ? "HIGH" : "MEDIUM",
      explanation: `Observed ${input.observed.toFixed(3)} is outside the rolling ±2σ band around mean ${input.baselineMean.toFixed(3)} (n=${input.sampleCount}). This is above/below normal — not a prediction.`
    });
  }

  if (input.baselineP95 != null && input.observed > input.baselineP95 * 1.25) {
    results.push({
      method: "PERCENTILE_DEVIATION",
      expectedMin: 0,
      expectedMax: input.baselineP95,
      deviation: input.observed - input.baselineP95,
      severity: "MEDIUM",
      explanation: `Observed ${input.observed.toFixed(3)} exceeds p95 ${input.baselineP95.toFixed(3)} by >25%. Above normal relative to historical percentile.`
    });
  }

  const rateOfChange =
    Math.abs(input.baselineMean) > 1e-9
      ? (input.observed - input.baselineMean) / Math.abs(input.baselineMean)
      : 0;
  if (rateOfChange >= 0.5) {
    results.push({
      method: "RATE_OF_CHANGE",
      expectedMin: input.baselineMean * 0.5,
      expectedMax: input.baselineMean * 1.5,
      deviation: rateOfChange,
      severity: rateOfChange >= 1 ? "HIGH" : "MEDIUM",
      explanation: `Rate of change ${(rateOfChange * 100).toFixed(0)}% versus baseline mean. Sustained confirmation still required for deterioration classification.`
    });
  }

  return results;
};

const latestObservedValue = async (input: {
  organizationId: string;
  projectId: string;
  metricKey: string;
}): Promise<{ value: number; at: Date } | null> => {
  const since = new Date(Date.now() - STALE_MS);

  if (input.metricKey === "response_time_ms" || input.metricKey === "availability_ratio") {
    const rows = await prisma.checkResult.findMany({
      where: {
        Check: { Service: { projectId: input.projectId } },
        checkedAt: { gte: since }
      },
      orderBy: { checkedAt: "desc" },
      take: 20,
      select: { responseTimeMs: true, status: true, checkedAt: true }
    });
    if (rows.length === 0) return null;
    if (input.metricKey === "response_time_ms") {
      const value = rows[0]?.responseTimeMs;
      return value == null ? null : { value, at: rows[0]!.checkedAt };
    }
    const ratio = rows.filter((row) => row.status === "PASS").length / rows.length;
    return { value: ratio, at: rows[0]!.checkedAt };
  }

  if (
    input.metricKey === "error_rate" ||
    input.metricKey === "p95_latency_ms" ||
    input.metricKey === "request_throughput"
  ) {
    const window = await prisma.apmServiceWindow.findFirst({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        windowEnd: { gte: since }
      },
      orderBy: { windowEnd: "desc" }
    });
    if (!window) return null;
    if (input.metricKey === "error_rate") return { value: window.errorRate, at: window.windowEnd };
    if (input.metricKey === "p95_latency_ms") {
      return window.latencyP95Ms == null
        ? null
        : { value: window.latencyP95Ms, at: window.windowEnd };
    }
    return { value: window.requestCount, at: window.windowEnd };
  }

  return null;
};

const relatedOpsContext = async (organizationId: string, projectId: string) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true }
  });
  if (!project) {
    return { changeIds: [] as string[], alertIds: [] as string[], incidentIds: [] as string[] };
  }

  const [changes, alerts, incidents] = await Promise.all([
    prisma.changeEvent.findMany({
      where: { organizationId, projectId, createdAt: { gte: since } },
      select: { id: true },
      take: 10
    }),
    prisma.alert.findMany({
      where: { projectId, firstSeenAt: { gte: since } },
      select: { id: true },
      take: 10
    }),
    prisma.incident.findMany({
      where: { projectId, openedAt: { gte: since } },
      select: { id: true },
      take: 10
    })
  ]);
  return {
    changeIds: changes.map((row) => row.id),
    alertIds: alerts.map((row) => row.id),
    incidentIds: incidents.map((row) => row.id)
  };
};
