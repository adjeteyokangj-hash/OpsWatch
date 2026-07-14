import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { MIN_BASELINE_SAMPLES } from "./intelligence-constants";
import { recordOperationsTimelineEvent } from "./observation.service";
import { TIMELINE_EVENT } from "./intelligence-constants";

export type BaselineMetrics = Record<string, number | string | boolean | null>;

export const upsertLearningBaseline = async (input: {
  organizationId: string;
  projectId?: string | null;
  scopeType: string;
  scopeKey: string;
  sampleIncrement?: number;
  metrics: BaselineMetrics;
  lastSampleAt?: Date;
}): Promise<{ id: string; sampleCount: number; ready: boolean }> => {
  const projectId = input.projectId ?? "";
  const now = new Date();
  const existing = await prisma.learningBaseline.findUnique({
    where: {
      organizationId_projectId_scopeType_scopeKey: {
        organizationId: input.organizationId,
        projectId,
        scopeType: input.scopeType,
        scopeKey: input.scopeKey
      }
    }
  });

  const sampleIncrement = input.sampleIncrement ?? 1;
  if (!existing) {
    const id = randomUUID();
    const sampleCount = sampleIncrement;
    await prisma.learningBaseline.create({
      data: {
        id,
        organizationId: input.organizationId,
        projectId,
        scopeType: input.scopeType,
        scopeKey: input.scopeKey,
        sampleCount,
        metricsJson: input.metrics,
        lastSampleAt: input.lastSampleAt ?? now,
        updatedAt: now
      }
    });
    if (sampleCount >= MIN_BASELINE_SAMPLES) {
      await recordOperationsTimelineEvent({
        organizationId: input.organizationId,
        projectId: projectId || null,
        eventType: TIMELINE_EVENT.BASELINE_UPDATED,
        summary: `Baseline ready for ${input.scopeType}:${input.scopeKey} (${sampleCount} samples)`,
        sourceType: "BASELINE",
        sourceId: id
      });
    }
    return { id, sampleCount, ready: sampleCount >= MIN_BASELINE_SAMPLES };
  }

  const prevMetrics =
    existing.metricsJson && typeof existing.metricsJson === "object"
      ? (existing.metricsJson as BaselineMetrics)
      : {};
  const merged = { ...prevMetrics, ...input.metrics };
  const sampleCount = existing.sampleCount + sampleIncrement;
  await prisma.learningBaseline.update({
    where: { id: existing.id },
    data: {
      sampleCount,
      metricsJson: merged,
      lastSampleAt: input.lastSampleAt ?? now,
      updatedAt: now
    }
  });

  return {
    id: existing.id,
    sampleCount,
    ready: sampleCount >= MIN_BASELINE_SAMPLES
  };
};

export const listLearningBaselines = async (
  organizationId: string,
  options?: { projectId?: string; scopeType?: string; limit?: number }
) => {
  const limit = Math.min(options?.limit ?? 100, 500);
  return prisma.learningBaseline.findMany({
    where: {
      organizationId,
      ...(options?.projectId != null ? { projectId: options.projectId } : {}),
      ...(options?.scopeType ? { scopeType: options.scopeType } : {})
    },
    orderBy: { updatedAt: "desc" },
    take: limit
  });
};
