import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  ALGORITHM,
  DATA_QUALITY,
  isLearningStageEnabled,
  MIN_BASELINE_SAMPLES_PHASE9
} from "./learning-flags";
import { computeSampleStats, confidenceFromSamples, isTestOrFixtureProject } from "./learning-stats";

const WINDOW_MS = 60 * 60 * 1000;

export type BaselineRefreshResult = {
  skipped: boolean;
  reason?: string;
  upserted: number;
  excludedTestProjects: number;
};

/**
 * Calculate MetricBaseline rows from live CheckResult / Apm windows.
 * Does not invent values from fixtures. Confidence is insufficient below min samples.
 */
export const refreshMetricBaselinesForOrg = async (
  organizationId: string
): Promise<BaselineRefreshResult> => {
  if (!isLearningStageEnabled("BASELINE_CALCULATION")) {
    return { skipped: true, reason: "BASELINE_CALCULATION disabled", upserted: 0, excludedTestProjects: 0 };
  }

  const projects = await prisma.project.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, slug: true, name: true, clientName: true, environment: true }
  });

  let excludedTestProjects = 0;
  let upserted = 0;
  const now = new Date();
  const since = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  for (const project of projects) {
    if (isTestOrFixtureProject(project)) {
      excludedTestProjects += 1;
      continue;
    }

    const checkResults = await prisma.checkResult.findMany({
      where: {
        Check: { Service: { projectId: project.id } },
        checkedAt: { gte: since }
      },
      select: { status: true, responseTimeMs: true, checkedAt: true },
      take: 5000,
      orderBy: { checkedAt: "desc" }
    });

    const latencies = checkResults
      .map((row) => row.responseTimeMs)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const availabilitySamples = checkResults.map((row) => (row.status === "PASS" ? 1 : 0));

    upserted += await upsertBaseline({
      organizationId,
      projectId: project.id,
      environment: project.environment || "unknown",
      metricKey: "response_time_ms",
      values: latencies,
      now
    });
    upserted += await upsertBaseline({
      organizationId,
      projectId: project.id,
      environment: project.environment || "unknown",
      metricKey: "availability_ratio",
      values: availabilitySamples,
      now
    });

    const apmWindows = await prisma.apmServiceWindow.findMany({
      where: {
        organizationId,
        projectId: project.id,
        windowEnd: { gte: since }
      },
      take: 500,
      orderBy: { windowEnd: "desc" }
    });

    upserted += await upsertBaseline({
      organizationId,
      projectId: project.id,
      environment: project.environment || "unknown",
      metricKey: "error_rate",
      values: apmWindows.map((row) => row.errorRate).filter((v) => Number.isFinite(v)),
      now
    });
    upserted += await upsertBaseline({
      organizationId,
      projectId: project.id,
      environment: project.environment || "unknown",
      metricKey: "p95_latency_ms",
      values: apmWindows
        .map((row) => row.latencyP95Ms)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
      now
    });
    upserted += await upsertBaseline({
      organizationId,
      projectId: project.id,
      environment: project.environment || "unknown",
      metricKey: "request_throughput",
      values: apmWindows.map((row) => row.requestCount).filter((v) => Number.isFinite(v)),
      now
    });

    // Security event volume baseline (Phase 8 evidence).
    const securityEvents = await prisma.securityEvent.findMany({
      where: { organizationId, projectId: project.id, timestamp: { gte: since } },
      select: { timestamp: true, eventType: true },
      take: 5000
    });
    const byHour = new Map<string, number>();
    for (const event of securityEvents) {
      const key = event.timestamp.toISOString().slice(0, 13);
      byHour.set(key, (byHour.get(key) || 0) + 1);
    }
    upserted += await upsertBaseline({
      organizationId,
      projectId: project.id,
      environment: project.environment || "unknown",
      metricKey: "security_event_volume",
      values: Array.from(byHour.values()),
      now
    });

    const loginFailures = securityEvents.filter((event) => event.eventType === "LOGIN_FAILED");
    const loginByHour = new Map<string, number>();
    for (const event of loginFailures) {
      const key = event.timestamp.toISOString().slice(0, 13);
      loginByHour.set(key, (loginByHour.get(key) || 0) + 1);
    }
    upserted += await upsertBaseline({
      organizationId,
      projectId: project.id,
      environment: project.environment || "unknown",
      metricKey: "login_failure_volume",
      values: Array.from(loginByHour.values()),
      now
    });
  }

  return { skipped: false, upserted, excludedTestProjects };
};

const upsertBaseline = async (args: {
  organizationId: string;
  projectId: string;
  environment: string;
  metricKey: string;
  values: number[];
  now: Date;
}): Promise<number> => {
  const stats = computeSampleStats(args.values);
  const stability =
    stats.mean && stats.variance != null && stats.mean !== 0
      ? Math.max(0, 1 - Math.min(1, Math.sqrt(stats.variance) / Math.abs(stats.mean)))
      : stats.sampleCount >= MIN_BASELINE_SAMPLES_PHASE9
        ? 0.6
        : 0.2;
  const confidence = confidenceFromSamples(stats.sampleCount, stability);
  const dataQualityState =
    stats.sampleCount < MIN_BASELINE_SAMPLES_PHASE9
      ? DATA_QUALITY.INSUFFICIENT_SAMPLES
      : DATA_QUALITY.LIVE;

  const existing = await prisma.metricBaseline.findFirst({
    where: {
      organizationId: args.organizationId,
      projectId: args.projectId,
      environment: args.environment,
      entityId: null,
      metricKey: args.metricKey,
      windowMs: WINDOW_MS,
      seasonalBucket: null
    }
  });

  const data = {
    sampleCount: stats.sampleCount,
    mean: stats.mean,
    median: stats.median,
    p50: stats.p50,
    p95: stats.p95,
    variance: stats.variance,
    minValue: stats.minValue,
    maxValue: stats.maxValue,
    confidence: confidence.score,
    confidenceLabel: confidence.label,
    dataQualityState,
    firstSampleAt: stats.sampleCount ? args.now : null,
    lastSampleAt: stats.sampleCount ? args.now : null,
    lastRecalculatedAt: args.now,
    algorithmVersion: ALGORITHM.METRIC_BASELINE,
    sourceQualityJson: {
      excludedFixtures: true,
      minSamples: MIN_BASELINE_SAMPLES_PHASE9
    } as Prisma.InputJsonValue,
    updatedAt: args.now
  };

  if (existing) {
    await prisma.metricBaseline.update({ where: { id: existing.id }, data });
  } else {
    await prisma.metricBaseline.create({
      data: {
        id: randomUUID(),
        organizationId: args.organizationId,
        projectId: args.projectId,
        environment: args.environment,
        entityId: null,
        relationshipId: null,
        metricKey: args.metricKey,
        windowMs: WINDOW_MS,
        seasonalBucket: null,
        ...data
      }
    });
  }
  return 1;
};
