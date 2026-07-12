import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";

const SHORT_WINDOW_MINUTES = Number(process.env.WORKER_SLO_WINDOW_MINUTES || 60);

export type SloSample = { status: string; responseTimeMs: number | null };
export type SloEvaluation = { availabilityPct: number; errorRatePct: number; p95LatencyMs: number | null; burnRate: number; status: string };
const clamp = (value: number) => Number(Math.max(0, Math.min(100, value)).toFixed(2));
const p95 = (values: number[]): number | null => values.length ? ([...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)] ?? null) : null;

export const calculateSloEvaluation = (samples: SloSample[], definition: { sliType: string; targetPct: number; latencyThresholdMs: number | null }): SloEvaluation | null => {
  if (!samples.length) return null;
  const latency = samples.map(row => row.responseTimeMs).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  let good = samples.filter(row => row.status !== "FAIL").length;
  let total = samples.length;
  if (definition.sliType === "LATENCY") {
    if (!definition.latencyThresholdMs || !latency.length) return null;
    good = latency.filter(value => value <= definition.latencyThresholdMs!).length; total = latency.length;
  }
  const availabilityPct = clamp(good / total * 100);
  const errorRatePct = clamp(100 - availabilityPct);
  const burnRate = Number((errorRatePct / Math.max(0.0001, 100 - definition.targetPct)).toFixed(2));
  return { availabilityPct, errorRatePct, p95LatencyMs: p95(latency), burnRate, status: burnRate >= 2 ? "BREACHING" : burnRate >= 1 ? "AT_RISK" : "HEALTHY" };
};

const syncAlert = async (definition: { id: string; projectId: string; serviceId: string | null; name: string }, evaluation: SloEvaluation) => {
  const existing = await prisma.alert.findFirst({ where: { projectId: definition.projectId, sourceType: "SLO", sourceId: definition.id, status: { in: ["OPEN", "ACKNOWLEDGED"] } } });
  if (evaluation.status === "HEALTHY") {
    if (existing) await prisma.alert.update({ where: { id: existing.id }, data: { status: "RESOLVED", resolvedAt: new Date(), lastSeenAt: new Date() } });
    return;
  }
  const severity = evaluation.status === "BREACHING" ? "HIGH" : "MEDIUM";
  if (existing) {
    await prisma.alert.update({ where: { id: existing.id }, data: { severity, lastSeenAt: new Date(), message: `Burn rate ${evaluation.burnRate}x; compliance ${evaluation.availabilityPct}%` } });
  } else {
    await prisma.alert.create({ data: { id: randomUUID(), projectId: definition.projectId, serviceId: definition.serviceId, sourceType: "SLO", sourceId: definition.id, severity, category: "RELIABILITY", title: `SLO budget at risk: ${definition.name}`, message: `Burn rate ${evaluation.burnRate}x; compliance ${evaluation.availabilityPct}%` } });
  }
};

export const evaluateSloBurnRateJob = async (): Promise<void> => {
  const now = new Date();
  const definitions = await prisma.sLODefinition.findMany({ where: { enabled: true, archivedAt: null }, select: { id: true, projectId: true, serviceId: true, name: true, sliType: true, targetPct: true, latencyThresholdMs: true, windowDays: true } });
  let windowsUpserted = 0;
  for (const definition of definitions) {
    const checks = await prisma.check.findMany({ where: { serviceId: definition.serviceId ?? undefined, ...(definition.serviceId ? {} : { Service: { projectId: definition.projectId } }), type: { in: ["HTTP", "RESPONSE_TIME"] }, isActive: true }, select: { id: true } });
    if (!checks.length) continue;
    const checkIds = checks.map(row => row.id);
    const durations = Array.from(new Set([Math.max(1, SHORT_WINDOW_MINUTES), definition.windowDays * 1440]));
    let shortEvaluation: SloEvaluation | null = null;
    for (const windowMinutes of durations) {
      const windowStart = new Date(now.getTime() - windowMinutes * 60_000);
      const samples = await prisma.checkResult.findMany({ where: { checkId: { in: checkIds }, checkedAt: { gte: windowStart, lte: now } }, select: { status: true, responseTimeMs: true } });
      const evaluation = calculateSloEvaluation(samples, definition); if (!evaluation) continue;
      if (windowMinutes === durations[0]) shortEvaluation = evaluation;
      await prisma.sLOWindow.upsert({ where: { sloDefinitionId_windowStart_windowEnd: { sloDefinitionId: definition.id, windowStart, windowEnd: now } }, create: { id: randomUUID(), sloDefinitionId: definition.id, projectId: definition.projectId, windowStart, windowEnd: now, windowMinutes, ...evaluation }, update: evaluation });
      windowsUpserted += 1;
    }
    if (shortEvaluation) await syncAlert(definition, shortEvaluation);
  }
  logger.info(`SLO evaluation completed for ${definitions.length} definitions; upserted ${windowsUpserted} windows`);
};
