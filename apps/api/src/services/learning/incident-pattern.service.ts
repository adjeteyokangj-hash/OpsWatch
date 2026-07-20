import { createHash, randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ALGORITHM, DATA_QUALITY, isLearningStageEnabled } from "./learning-flags";

const MIN_ROOT_CAUSE_CONFIDENCE = 0.6;

export type PatternUpsertResult = {
  skipped: boolean;
  reason?: string;
  upserted: number;
};

/**
 * Persist confirmed incident-pattern memory from resolved incidents with
 * known root cause. Unresolved / low-confidence causes are excluded.
 */
export const refreshIncidentPatternMemory = async (
  organizationId: string
): Promise<PatternUpsertResult> => {
  if (!isLearningStageEnabled("INCIDENT_MATCHING")) {
    return { skipped: true, reason: "INCIDENT_MATCHING disabled", upserted: 0 };
  }

  const memories = await prisma.incidentMemoryEntry.findMany({
    where: {
      organizationId,
      rootCause: { not: null },
      resolvedAt: { not: null }
    },
    orderBy: { updatedAt: "desc" },
    take: 200
  });

  let upserted = 0;
  const now = new Date();

  for (const memory of memories) {
    const rootCause = memory.rootCause?.trim();
    if (!rootCause) continue;

    const fingerprint = buildIncidentFingerprint({
      category: memory.category,
      rootCause,
      affectedServiceIds: asStringArray(memory.affectedServiceIds)
    });

    const existing = await prisma.incidentPatternMemory.findUnique({
      where: {
        organizationId_fingerprint: { organizationId, fingerprint }
      }
    });

    const recoveryActions = asStringArray(memory.recoveryActionsJson);
    const sourceIds = existing
      ? Array.from(
          new Set([...asStringArray(existing.sourceIncidentIdsJson), memory.incidentId])
        )
      : [memory.incidentId];

    const data = {
      projectId: memory.projectId,
      title: memory.title.slice(0, 200),
      confirmedRootCause: rootCause,
      rootCauseConfidence: 0.75,
      affectedEntityIdsJson: memory.affectedServiceIds as Prisma.InputJsonValue,
      alertSequenceJson: memory.timelineJson as Prisma.InputJsonValue,
      evidenceSummaryJson: {
        diagnosisSummary: memory.diagnosisSummary,
        verificationSummary: memory.verificationSummary
      } as Prisma.InputJsonValue,
      remediationActionsJson: recoveryActions as Prisma.InputJsonValue,
      verificationOutcome: memory.verificationSummary,
      timeToRecoverMs: memory.resolutionTimeMs,
      recurrenceCount: sourceIds.length,
      successfulActionKeysJson: recoveryActions as Prisma.InputJsonValue,
      failedActionKeysJson: [] as Prisma.InputJsonValue,
      displayEligible: true,
      dataQualityState: DATA_QUALITY.LIVE,
      sourceIncidentIdsJson: sourceIds as Prisma.InputJsonValue,
      lastSeenAt: memory.resolvedAt ?? now,
      updatedAt: now
    };

    if (existing) {
      if ((existing.rootCauseConfidence ?? 0) < MIN_ROOT_CAUSE_CONFIDENCE && !existing.confirmedRootCause) {
        continue;
      }
      await prisma.incidentPatternMemory.update({
        where: { id: existing.id },
        data
      });
    } else {
      await prisma.incidentPatternMemory.create({
        data: {
          id: randomUUID(),
          organizationId,
          fingerprint,
          ...data
        }
      });
    }
    upserted += 1;
  }

  return { skipped: false, upserted };
};

export const buildIncidentFingerprint = (input: {
  category?: string | null;
  rootCause: string;
  affectedServiceIds?: string[];
}): string => {
  const normalized = [
    (input.category ?? "uncategorized").toLowerCase().trim(),
    input.rootCause.toLowerCase().replace(/\s+/g, " ").trim(),
    ...(input.affectedServiceIds ?? []).map((id) => id.toLowerCase()).sort()
  ].join("|");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
};

export type SimilarIncidentResult = {
  matchingIncidentIds: string[];
  similarityScore: number;
  matchingEvidence: string[];
  importantDifferences: string[];
  previouslySuccessfulActions: string[];
  previouslyFailedActions: string[];
  note: string;
};

/**
 * Explainable similar-incident matching. Similarity ≠ same cause.
 */
export const matchSimilarIncidents = async (input: {
  organizationId: string;
  incidentId: string;
  projectId?: string | null;
  title: string;
  category?: string | null;
  rootCause?: string | null;
  affectedEntityIds?: string[];
  alertTitles?: string[];
}): Promise<SimilarIncidentResult | { skipped: true; reason: string }> => {
  if (!isLearningStageEnabled("INCIDENT_MATCHING")) {
    return { skipped: true, reason: "INCIDENT_MATCHING disabled" };
  }

  const patterns = await prisma.incidentPatternMemory.findMany({
    where: {
      organizationId: input.organizationId,
      displayEligible: true,
      dataQualityState: { notIn: [DATA_QUALITY.TEST_EXCLUDED, DATA_QUALITY.FIXTURE_EXCLUDED] }
    },
    take: 100
  });

  const candidates: Array<SimilarIncidentResult & { patternId: string }> = [];

  for (const pattern of patterns) {
    const matchingEvidence: string[] = [];
    const importantDifferences: string[] = [];
    let score = 0;

    const patternEntities = asStringArray(pattern.affectedEntityIdsJson);
    const sharedEntities = (input.affectedEntityIds ?? []).filter((id) =>
      patternEntities.includes(id)
    );
    if (sharedEntities.length > 0) {
      score += 0.35;
      matchingEvidence.push(`Shared entities: ${sharedEntities.slice(0, 5).join(", ")}`);
    } else if (patternEntities.length > 0 && (input.affectedEntityIds?.length ?? 0) > 0) {
      importantDifferences.push("Affected entities differ");
    }

    if (
      input.category &&
      pattern.title.toLowerCase().includes(input.category.toLowerCase())
    ) {
      score += 0.1;
      matchingEvidence.push(`Category overlap: ${input.category}`);
    }

    if (input.rootCause && pattern.confirmedRootCause) {
      const a = input.rootCause.toLowerCase();
      const b = pattern.confirmedRootCause.toLowerCase();
      if (a === b) {
        score += 0.4;
        matchingEvidence.push("Identical confirmed root-cause text");
      } else if (a.includes(b) || b.includes(a)) {
        score += 0.2;
        matchingEvidence.push("Partial root-cause text overlap");
        importantDifferences.push("Root-cause wording is not identical");
      } else {
        importantDifferences.push("Root causes differ — do not assume same cause");
      }
    } else {
      importantDifferences.push("Current incident lacks confirmed root cause");
    }

    const fingerprint = buildIncidentFingerprint({
      category: input.category,
      rootCause: input.rootCause ?? input.title,
      affectedServiceIds: input.affectedEntityIds
    });
    if (fingerprint === pattern.fingerprint) {
      score += 0.25;
      matchingEvidence.push("Shared incident fingerprint");
    }

    if (score < 0.35) continue;

    candidates.push({
      patternId: pattern.id,
      matchingIncidentIds: asStringArray(pattern.sourceIncidentIdsJson),
      similarityScore: Math.min(1, Number(score.toFixed(3))),
      matchingEvidence,
      importantDifferences,
      previouslySuccessfulActions: asStringArray(pattern.successfulActionKeysJson),
      previouslyFailedActions: asStringArray(pattern.failedActionKeysJson),
      note: "Similarity indicates overlapping evidence only — not proof of the same cause."
    });
  }

  candidates.sort((a, b) => b.similarityScore - a.similarityScore);
  const best = candidates[0];
  if (!best) {
    return {
      matchingIncidentIds: [],
      similarityScore: 0,
      matchingEvidence: [],
      importantDifferences: ["No eligible pattern memory matched"],
      previouslySuccessfulActions: [],
      previouslyFailedActions: [],
      note: "Similarity indicates overlapping evidence only — not proof of the same cause."
    };
  }

  const { patternId: _patternId, ...result } = best;
  return result;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
};
