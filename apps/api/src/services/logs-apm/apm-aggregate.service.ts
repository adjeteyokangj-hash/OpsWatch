import { createHash, randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  APM_METRIC_FRESH_MS,
  isTraceApmProcessingEnabled,
  MIN_SAMPLES_FOR_HEALTH,
  MIN_SAMPLES_FOR_P95,
  MIN_SAMPLES_FOR_P99
} from "./logs-apm-feature-flags";
import { evaluateApmHealth } from "./apm-health.service";

export type WindowSize = "1m" | "5m" | "15m" | "1h";

const WINDOW_MS: Record<WindowSize, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000
};

export const windowBounds = (
  observedAt: Date,
  size: WindowSize
): { windowStart: Date; windowEnd: Date } => {
  const ms = WINDOW_MS[size];
  const startMs = Math.floor(observedAt.getTime() / ms) * ms;
  return { windowStart: new Date(startMs), windowEnd: new Date(startMs + ms) };
};

const percentile = (sorted: number[], p: number): number | null => {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? null;
};

const confidenceFor = (sampleCount: number): number => {
  if (sampleCount < MIN_SAMPLES_FOR_HEALTH) return 0.2;
  if (sampleCount < MIN_SAMPLES_FOR_P95) return 0.5;
  if (sampleCount < MIN_SAMPLES_FOR_P99) return 0.75;
  return 0.95;
};

export type SpanSample = {
  organizationId: string;
  projectId: string | null;
  environment: string;
  serviceName: string;
  entityId: string | null;
  operation: string;
  httpMethod: string | null;
  durationMs: number | null;
  isError: boolean;
  isSlow: boolean;
  isTimeout: boolean;
  observedAt: Date;
  destinationEntityId?: string | null;
  targetServiceName?: string | null;
  relationshipId?: string | null;
  isDependency?: boolean;
};

/** Idempotent contribution of one span sample into 1m window; roll-up copies to longer windows. */
export const contributeSpanToApmWindows = async (sample: SpanSample): Promise<void> => {
  if (!isTraceApmProcessingEnabled()) return;
  const duration = sample.durationMs ?? 0;
  for (const size of ["1m", "5m", "15m", "1h"] as WindowSize[]) {
    await upsertServiceWindow(sample, size, duration);
    await upsertEndpointWindow(sample, size, duration);
    if (sample.isDependency && sample.targetServiceName) {
      await upsertDependencyWindow(sample, size, duration);
    }
  }
};

const upsertServiceWindow = async (
  sample: SpanSample,
  size: WindowSize,
  duration: number
): Promise<void> => {
  const { windowStart, windowEnd } = windowBounds(sample.observedAt, size);
  const existing = await prisma.apmServiceWindow.findFirst({
    where: {
      organizationId: sample.organizationId,
      projectId: sample.projectId,
      serviceName: sample.serviceName,
      environment: sample.environment,
      windowSize: size,
      windowStart
    }
  });

  const requestCount = (existing?.requestCount ?? 0) + 1;
  const errorCount = (existing?.errorCount ?? 0) + (sample.isError ? 1 : 0);
  const latencySumMs = (existing?.latencySumMs ?? 0) + duration;
  const sampleCount = (existing?.sampleCount ?? 0) + 1;
  const latencyAvgMs = latencySumMs / requestCount;
  const errorRate = requestCount > 0 ? errorCount / requestCount : 0;
  const availability = requestCount > 0 ? (requestCount - errorCount) / requestCount : null;

  // Approximate percentiles from running avg/max when we lack a histogram store.
  const latencies = [existing?.latencyP50Ms, existing?.latencyP95Ms, duration].filter(
    (v): v is number => typeof v === "number"
  );
  latencies.sort((a, b) => a - b);
  const latencyP50Ms = sampleCount >= MIN_SAMPLES_FOR_HEALTH ? percentile(latencies, 50) : null;
  const latencyP95Ms = sampleCount >= MIN_SAMPLES_FOR_P95 ? percentile(latencies, 95) : null;
  const latencyP99Ms = sampleCount >= MIN_SAMPLES_FOR_P99 ? percentile(latencies, 99) : null;

  const freshUntil = new Date(sample.observedAt.getTime() + APM_METRIC_FRESH_MS());
  const healthEval = evaluateApmHealth({
    errorRate,
    latencyP95Ms,
    sampleCount,
    baselineLatencyP95Ms: existing?.latencyP95Ms ?? null,
    baselineErrorRate: existing?.errorRate ?? null,
    freshUntil,
    now: sample.observedAt
  });

  const data = {
    entityId: sample.entityId,
    requestCount,
    errorCount,
    errorRate,
    latencySumMs,
    latencyAvgMs,
    latencyP50Ms,
    latencyP95Ms,
    latencyP99Ms,
    availability,
    sampleCount,
    confidence: confidenceFor(sampleCount),
    health: healthEval.health,
    healthRule: healthEval.rule,
    healthEvidenceJson: healthEval.evidence as Prisma.InputJsonValue,
    lastObservedAt: sample.observedAt,
    freshUntil,
    lastEvaluatedAt: sample.observedAt,
    updatedAt: new Date()
  };

  if (existing) {
    await prisma.apmServiceWindow.update({ where: { id: existing.id }, data });
  } else {
    await prisma.apmServiceWindow.create({
      data: {
        id: randomUUID(),
        organizationId: sample.organizationId,
        projectId: sample.projectId,
        serviceName: sample.serviceName,
        environment: sample.environment,
        windowSize: size,
        windowStart,
        windowEnd,
        ...data
      }
    });
  }
};

const upsertEndpointWindow = async (
  sample: SpanSample,
  size: WindowSize,
  duration: number
): Promise<void> => {
  const { windowStart, windowEnd } = windowBounds(sample.observedAt, size);
  const existing = await prisma.apmEndpointWindow.findFirst({
    where: {
      organizationId: sample.organizationId,
      projectId: sample.projectId,
      serviceName: sample.serviceName,
      environment: sample.environment,
      operation: sample.operation,
      windowSize: size,
      windowStart
    }
  });
  const requestCount = (existing?.requestCount ?? 0) + 1;
  const errorCount = (existing?.errorCount ?? 0) + (sample.isError ? 1 : 0);
  const latencySumMs = (existing?.latencySumMs ?? 0) + duration;
  const sampleCount = (existing?.sampleCount ?? 0) + 1;
  const errorRate = requestCount > 0 ? errorCount / requestCount : 0;
  const latencies = [existing?.latencyP95Ms, duration].filter((v): v is number => typeof v === "number");
  latencies.sort((a, b) => a - b);
  const freshUntil = new Date(sample.observedAt.getTime() + APM_METRIC_FRESH_MS());
  const healthEval = evaluateApmHealth({
    errorRate,
    latencyP95Ms: sampleCount >= MIN_SAMPLES_FOR_P95 ? percentile(latencies, 95) : null,
    sampleCount,
    baselineLatencyP95Ms: existing?.latencyP95Ms ?? null,
    baselineErrorRate: existing?.errorRate ?? null,
    freshUntil,
    now: sample.observedAt
  });

  const data = {
    entityId: sample.entityId,
    httpMethod: sample.httpMethod,
    requestCount,
    errorCount,
    errorRate,
    latencySumMs,
    latencyAvgMs: latencySumMs / requestCount,
    latencyP50Ms: sampleCount >= MIN_SAMPLES_FOR_HEALTH ? percentile(latencies, 50) : null,
    latencyP95Ms: sampleCount >= MIN_SAMPLES_FOR_P95 ? percentile(latencies, 95) : null,
    latencyP99Ms: sampleCount >= MIN_SAMPLES_FOR_P99 ? percentile(latencies, 99) : null,
    slowRequestCount: (existing?.slowRequestCount ?? 0) + (sample.isSlow ? 1 : 0),
    failingTraceCount: (existing?.failingTraceCount ?? 0) + (sample.isError ? 1 : 0),
    sampleCount,
    confidence: confidenceFor(sampleCount),
    health: healthEval.health,
    healthRule: healthEval.rule,
    healthEvidenceJson: healthEval.evidence as Prisma.InputJsonValue,
    lastObservedAt: sample.observedAt,
    freshUntil,
    updatedAt: new Date()
  };

  if (existing) {
    await prisma.apmEndpointWindow.update({ where: { id: existing.id }, data });
  } else {
    await prisma.apmEndpointWindow.create({
      data: {
        id: randomUUID(),
        organizationId: sample.organizationId,
        projectId: sample.projectId,
        serviceName: sample.serviceName,
        environment: sample.environment,
        operation: sample.operation,
        windowSize: size,
        windowStart,
        windowEnd,
        ...data
      }
    });
  }
};

const upsertDependencyWindow = async (
  sample: SpanSample,
  size: WindowSize,
  duration: number
): Promise<void> => {
  if (!sample.targetServiceName) return;
  const { windowStart, windowEnd } = windowBounds(sample.observedAt, size);
  const existing = await prisma.apmDependencyWindow.findFirst({
    where: {
      organizationId: sample.organizationId,
      projectId: sample.projectId,
      sourceServiceName: sample.serviceName,
      targetServiceName: sample.targetServiceName,
      environment: sample.environment,
      windowSize: size,
      windowStart
    }
  });
  const requestCount = (existing?.requestCount ?? 0) + 1;
  const errorCount = (existing?.errorCount ?? 0) + (sample.isError ? 1 : 0);
  const timeoutCount = (existing?.timeoutCount ?? 0) + (sample.isTimeout ? 1 : 0);
  const latencySumMs = (existing?.latencySumMs ?? 0) + duration;
  const sampleCount = (existing?.sampleCount ?? 0) + 1;
  const errorRate = requestCount > 0 ? errorCount / requestCount : 0;
  const timeoutRate = requestCount > 0 ? timeoutCount / requestCount : 0;
  const latencies = [existing?.latencyP95Ms, duration].filter((v): v is number => typeof v === "number");
  latencies.sort((a, b) => a - b);
  const latencyP95Ms = sampleCount >= MIN_SAMPLES_FOR_P95 ? percentile(latencies, 95) : null;
  const freshUntil = new Date(sample.observedAt.getTime() + APM_METRIC_FRESH_MS());
  const healthEval = evaluateApmHealth({
    errorRate,
    latencyP95Ms,
    sampleCount,
    baselineLatencyP95Ms: existing?.latencyP95Ms ?? null,
    baselineErrorRate: existing?.errorRate ?? null,
    freshUntil,
    now: sample.observedAt,
    dependencyFailed: sample.isError || sample.isTimeout
  });

  const data = {
    relationshipId: sample.relationshipId ?? null,
    sourceEntityId: sample.entityId,
    targetEntityId: sample.destinationEntityId ?? null,
    requestCount,
    errorCount,
    errorRate,
    timeoutCount,
    timeoutRate,
    latencySumMs,
    latencyAvgMs: latencySumMs / requestCount,
    latencyP95Ms,
    sampleCount,
    confidence: confidenceFor(sampleCount),
    health: healthEval.health,
    healthRule: healthEval.rule,
    healthEvidenceJson: healthEval.evidence as Prisma.InputJsonValue,
    lastSuccessAt: sample.isError ? existing?.lastSuccessAt ?? null : sample.observedAt,
    lastFailureAt: sample.isError || sample.isTimeout ? sample.observedAt : existing?.lastFailureAt ?? null,
    lastObservedAt: sample.observedAt,
    freshUntil,
    updatedAt: new Date()
  };

  if (existing) {
    await prisma.apmDependencyWindow.update({ where: { id: existing.id }, data });
  } else {
    await prisma.apmDependencyWindow.create({
      data: {
        id: randomUUID(),
        organizationId: sample.organizationId,
        projectId: sample.projectId,
        sourceServiceName: sample.serviceName,
        targetServiceName: sample.targetServiceName,
        environment: sample.environment,
        windowSize: size,
        windowStart,
        windowEnd,
        ...data
      }
    });
  }

  // Reflect dependency health onto canonical relationship when linked.
  if (sample.relationshipId && size === "5m") {
    await prisma.operationalRelationship.update({
      where: { id: sample.relationshipId },
      data: {
        latencyP95Ms: latencyP95Ms ?? undefined,
        errorRate,
        health: healthEval.health,
        lastObservedAt: sample.observedAt,
        freshUntil,
        updatedAt: new Date()
      }
    });
  }
};

export const apmFingerprint = (parts: string[]): string =>
  createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
