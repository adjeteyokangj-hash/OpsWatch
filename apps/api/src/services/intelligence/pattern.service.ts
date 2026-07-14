import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { computeConfidence } from "./confidence.service";
import { MIN_DISPLAY_CONFIDENCE, type PatternType } from "./intelligence-constants";
import { recordAiDecisionAudit } from "./observation.service";
import { AI_DECISION_TYPE } from "./intelligence-constants";

export const upsertOperationalPattern = async (input: {
  organizationId: string;
  projectId?: string | null;
  patternType: PatternType | string;
  signatureKey: string;
  title: string;
  description: string;
  evidenceIncrement?: number;
  evidenceJson?: Record<string, unknown> | null;
  historicalAccuracy?: number | null;
  matchingIncidents?: number;
  recoveryMatches?: number;
  dataCompleteness?: number;
}): Promise<{
  id: string;
  confidenceScore: number;
  displayEligible: boolean;
}> => {
  const now = new Date();
  const existing = await prisma.operationalPattern.findUnique({
    where: {
      organizationId_patternType_signatureKey: {
        organizationId: input.organizationId,
        patternType: input.patternType,
        signatureKey: input.signatureKey
      }
    }
  });

  const evidenceCount =
    (existing?.evidenceCount ?? 0) + (input.evidenceIncrement ?? 1);

  const confidence = computeConfidence({
    evidenceCount,
    historicalAccuracy: input.historicalAccuracy,
    matchingIncidents: input.matchingIncidents ?? 0,
    recoveryMatches: input.recoveryMatches ?? 0,
    dataCompleteness: input.dataCompleteness ?? Math.min(1, evidenceCount / 10)
  });

  const displayEligible =
    confidence.displayEligible && confidence.score >= MIN_DISPLAY_CONFIDENCE;

  if (!existing) {
    const id = randomUUID();
    await prisma.operationalPattern.create({
      data: {
        id,
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        patternType: input.patternType,
        signatureKey: input.signatureKey,
        title: input.title,
        description: input.description,
        evidenceCount,
        confidenceScore: confidence.score,
        evidenceJson: (input.evidenceJson ?? undefined) as object | undefined,
        lastMatchedAt: now,
        displayEligible,
        updatedAt: now
      }
    });

    await prisma.aiConfidenceRecord.create({
      data: {
        id: randomUUID(),
        organizationId: input.organizationId,
        subjectType: "PATTERN",
        subjectId: id,
        score: confidence.score,
        label: confidence.label,
        evidenceCount: confidence.evidenceCount,
        historicalAccuracy: confidence.historicalAccuracy,
        matchingIncidents: confidence.matchingIncidents,
        recoveryMatches: confidence.recoveryMatches,
        dataCompleteness: confidence.dataCompleteness,
        factorsJson: confidence.factors
      }
    });

    if (!displayEligible) {
      await recordAiDecisionAudit({
        organizationId: input.organizationId,
        decisionType: AI_DECISION_TYPE.SUPPRESS,
        subjectType: "PATTERN",
        subjectId: id,
        summary: `Pattern "${input.title}" stored but not displayed (confidence ${confidence.score.toFixed(2)})`,
        confidenceScore: confidence.score,
        outcome: "SUPPRESSED"
      });
    }

    return { id, confidenceScore: confidence.score, displayEligible };
  }

  await prisma.operationalPattern.update({
    where: { id: existing.id },
    data: {
      title: input.title,
      description: input.description,
      evidenceCount,
      confidenceScore: confidence.score,
      evidenceJson: (input.evidenceJson ?? existing.evidenceJson ?? undefined) as object | undefined,
      lastMatchedAt: now,
      displayEligible,
      updatedAt: now,
      projectId: input.projectId ?? existing.projectId
    }
  });

  await prisma.aiConfidenceRecord.create({
    data: {
      id: randomUUID(),
      organizationId: input.organizationId,
      subjectType: "PATTERN",
      subjectId: existing.id,
      score: confidence.score,
      label: confidence.label,
      evidenceCount: confidence.evidenceCount,
      historicalAccuracy: confidence.historicalAccuracy,
      matchingIncidents: confidence.matchingIncidents,
      recoveryMatches: confidence.recoveryMatches,
      dataCompleteness: confidence.dataCompleteness,
      factorsJson: confidence.factors
    }
  });

  return {
    id: existing.id,
    confidenceScore: confidence.score,
    displayEligible
  };
};

export const listPatterns = async (
  organizationId: string,
  options?: { displayOnly?: boolean; limit?: number }
) => {
  const limit = Math.min(options?.limit ?? 50, 200);
  return prisma.operationalPattern.findMany({
    where: {
      organizationId,
      ...(options?.displayOnly ? { displayEligible: true } : {})
    },
    orderBy: [{ displayEligible: "desc" }, { confidenceScore: "desc" }],
    take: limit
  });
};
