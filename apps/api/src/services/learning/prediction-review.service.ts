import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { PREDICTION_REVIEW_STATE } from "./learning-flags";

export type ReviewAction =
  | "confirm"
  | "dismiss"
  | "mark_materialised"
  | "mark_prevented"
  | "mark_false_positive"
  | "expire";

/**
 * Human review workflow for prediction candidates.
 * High-impact candidates start as NEEDS_REVIEW before notification/action.
 */
export const reviewPredictionCandidate = async (input: {
  organizationId: string;
  predictionId: string;
  action: ReviewAction;
  actorUserId: string;
  note?: string;
  confidenceOverride?: number;
}): Promise<{ ok: true; reviewState: string } | { ok: false; error: string }> => {
  const row = await prisma.predictionCandidate.findFirst({
    where: { id: input.predictionId, organizationId: input.organizationId }
  });
  if (!row) return { ok: false, error: "Prediction not found" };

  const now = new Date();
  let reviewState = row.reviewState;
  let falsePositive = row.falsePositive;
  let actualOutcome = row.actualOutcome;

  switch (input.action) {
    case "confirm":
      reviewState = PREDICTION_REVIEW_STATE.CONFIRMED;
      break;
    case "dismiss":
      reviewState = PREDICTION_REVIEW_STATE.DISMISSED;
      break;
    case "mark_materialised":
      reviewState = PREDICTION_REVIEW_STATE.MATERIALISED;
      actualOutcome = "MATERIALISED";
      break;
    case "mark_prevented":
      reviewState = PREDICTION_REVIEW_STATE.PREVENTED;
      actualOutcome = "PREVENTED";
      break;
    case "mark_false_positive":
      reviewState = PREDICTION_REVIEW_STATE.FALSE_POSITIVE;
      falsePositive = true;
      actualOutcome = "FALSE_POSITIVE";
      break;
    case "expire":
      reviewState = PREDICTION_REVIEW_STATE.EXPIRED;
      actualOutcome = actualOutcome ?? "EXPIRED_WITHOUT_EVIDENCE";
      break;
    default:
      return { ok: false, error: "Unknown review action" };
  }

  const explanationJson = {
    ...(typeof row.explanationJson === "object" && row.explanationJson
      ? (row.explanationJson as Record<string, unknown>)
      : {}),
    administratorConfirmed:
      input.action === "confirm" || input.action === "mark_materialised",
    reviewNote: input.note ?? null,
    confidenceOverride: input.confidenceOverride ?? null,
    reviewedBy: input.actorUserId,
    reviewedAt: now.toISOString()
  };

  await prisma.predictionCandidate.update({
    where: { id: row.id },
    data: {
      reviewState,
      falsePositive,
      actualOutcome,
      reviewedBy: input.actorUserId,
      reviewedAt: now,
      reviewNote: input.note ?? null,
      confidenceScore:
        typeof input.confidenceOverride === "number"
          ? input.confidenceOverride
          : row.confidenceScore,
      explanationJson: explanationJson as Prisma.InputJsonValue,
      updatedAt: now
    }
  });

  const terminalStates = new Set<string>([
    PREDICTION_REVIEW_STATE.MATERIALISED,
    PREDICTION_REVIEW_STATE.PREVENTED,
    PREDICTION_REVIEW_STATE.FALSE_POSITIVE,
    PREDICTION_REVIEW_STATE.EXPIRED
  ]);

  // Outcome evaluation row when terminal.
  if (terminalStates.has(reviewState)) {
    const classification =
      reviewState === PREDICTION_REVIEW_STATE.MATERIALISED
        ? "MATERIALISED"
        : reviewState === PREDICTION_REVIEW_STATE.PREVENTED
          ? "PREVENTED"
          : reviewState === PREDICTION_REVIEW_STATE.FALSE_POSITIVE
            ? "DID_NOT_MATERIALISE"
            : "EXPIRED_WITHOUT_EVIDENCE";

    const leadTimeMs =
      row.computedAt && classification === "MATERIALISED"
        ? Math.max(0, now.getTime() - row.computedAt.getTime())
        : null;

    await prisma.predictionOutcomeEvaluation.upsert({
      where: { predictionId: row.id },
      create: {
        id: randomUUID(),
        organizationId: input.organizationId,
        predictionId: row.id,
        classification,
        leadTimeMs,
        notes: input.note ?? null,
        evaluatedAt: now,
        evaluatedBy: input.actorUserId,
        metricsJson: {
          confidenceAtReview: row.confidenceScore,
          probability: row.probability
        }
      },
      update: {
        classification,
        leadTimeMs,
        notes: input.note ?? null,
        evaluatedAt: now,
        evaluatedBy: input.actorUserId
      }
    });
  }

  return { ok: true, reviewState };
};

export const summariseOutcomeMetrics = async (
  organizationId: string
): Promise<{
  evaluated: number;
  materialised: number;
  prevented: number;
  falsePositiveRate: number | null;
  precision: number | null;
  note: string;
}> => {
  const rows = await prisma.predictionOutcomeEvaluation.findMany({
    where: { organizationId },
    take: 500
  });
  const evaluated = rows.length;
  if (evaluated < 10) {
    return {
      evaluated,
      materialised: rows.filter((r) => r.classification === "MATERIALISED").length,
      prevented: rows.filter((r) => r.classification === "PREVENTED").length,
      falsePositiveRate: null,
      precision: null,
      note: "Insufficient evaluated outcomes to market prediction quality."
    };
  }

  const materialised = rows.filter((r) => r.classification === "MATERIALISED").length;
  const prevented = rows.filter((r) => r.classification === "PREVENTED").length;
  const didNot = rows.filter((r) => r.classification === "DID_NOT_MATERIALISE").length;
  const positive = materialised + prevented;
  const precision = positive / evaluated;
  const falsePositiveRate = didNot / evaluated;

  return {
    evaluated,
    materialised,
    prevented,
    falsePositiveRate: Number(falsePositiveRate.toFixed(3)),
    precision: Number(precision.toFixed(3)),
    note: "Organisation-scoped metrics only. No cross-client learning."
  };
};
