import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ALGORITHM, isLearningStageEnabled } from "./learning-flags";
import { getUniversalAction } from "../remediation/action-registry";

export type RemediationLearnResult = {
  skipped: boolean;
  reason?: string;
  upserted: number;
};

/**
 * Learn from RemediationExecutionRun outcomes. One success does not over-promote.
 * Failed verification reduces recommendation confidence. Rollback outcomes retained.
 */
export const learnFromRemediationOutcomes = async (
  organizationId: string
): Promise<RemediationLearnResult> => {
  const runs = await prisma.remediationExecutionRun.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 200
  });

  let upserted = 0;
  const now = new Date();

  for (const run of runs) {
    const actionKey = run.actionKey;
    if (!actionKey) continue;

    const verification = asRecord(run.verificationJson);
    const verificationStatus =
      typeof verification?.status === "string" ? verification.status : null;
    const verifiedOk =
      verificationStatus === "PASSED" ||
      verificationStatus === "SUCCESS" ||
      verification?.success === true;
    const rolledBack =
      run.status === "ROLLED_BACK" ||
      run.rollbackResultJson != null ||
      Boolean(asRecord(run.rollbackResultJson)?.executed);
    const failed =
      run.status === "FAILED" ||
      verificationStatus === "FAILED" ||
      verification?.success === false;

    let outcome: "SUCCESS" | "FAILURE" | "PARTIAL" | "ROLLBACK" = "PARTIAL";
    if (rolledBack) outcome = "ROLLBACK";
    else if (verifiedOk || run.status === "SUCCEEDED" || run.status === "VERIFIED")
      outcome = "SUCCESS";
    else if (failed) outcome = "FAILURE";

    const inputJson = asRecord(run.sanitisedInputJson);
    const patternFingerprint =
      typeof inputJson?.patternFingerprint === "string"
        ? inputJson.patternFingerprint
        : null;

    const existing = await prisma.remediationPatternOutcome.findFirst({
      where: {
        organizationId,
        projectId: run.projectId ?? null,
        patternFingerprint,
        actionKey
      }
    });

    const actionDef = getUniversalAction(actionKey);
    const riskLevel = actionDef?.riskLevel ?? run.riskLevel ?? "MEDIUM";
    const durationMs =
      run.startedAt && run.endedAt
        ? Math.max(0, run.endedAt.getTime() - run.startedAt.getTime())
        : 0;

    const next = {
      successCount: (existing?.successCount ?? 0) + (outcome === "SUCCESS" ? 1 : 0),
      failureCount: (existing?.failureCount ?? 0) + (outcome === "FAILURE" ? 1 : 0),
      partialCount: (existing?.partialCount ?? 0) + (outcome === "PARTIAL" ? 1 : 0),
      rollbackCount: (existing?.rollbackCount ?? 0) + (outcome === "ROLLBACK" ? 1 : 0),
      recurrenceAfterSuccess: existing?.recurrenceAfterSuccess ?? 0,
      totalRecoveryMs:
        BigInt(existing?.totalRecoveryMs?.toString() ?? "0") + BigInt(durationMs),
      lastOutcome: outcome,
      lastOutcomeAt: now,
      riskLevel,
      evidenceJson: {
        lastRunId: run.id,
        verificationStatus,
        retainedRollback: rolledBack,
        failureReason: run.failureReason
      } as Prisma.InputJsonValue,
      algorithmVersion: ALGORITHM.REMEDIATION_OUTCOME,
      updatedAt: now
    };

    const attempts =
      next.successCount + next.failureCount + next.partialCount + next.rollbackCount;
    const successRate = attempts === 0 ? 0 : next.successCount / attempts;
    let recommendationConfidence = 0;
    if (next.successCount >= 2 && successRate >= 0.6) {
      recommendationConfidence = Math.min(
        0.85,
        0.4 + successRate * 0.4 + Math.min(0.2, next.successCount * 0.05)
      );
    } else if (next.successCount === 1 && next.failureCount === 0) {
      recommendationConfidence = 0.25; // do not over-promote from one success
    } else if (next.failureCount > next.successCount) {
      recommendationConfidence = Math.max(0.05, 0.3 - next.failureCount * 0.05);
    } else {
      recommendationConfidence = Math.min(0.45, successRate * 0.5);
    }

    if (existing) {
      await prisma.remediationPatternOutcome.update({
        where: { id: existing.id },
        data: { ...next, recommendationConfidence }
      });
    } else {
      await prisma.remediationPatternOutcome.create({
        data: {
          id: randomUUID(),
          organizationId,
          projectId: run.projectId ?? null,
          patternFingerprint,
          actionKey,
          ...next,
          recommendationConfidence
        }
      });
    }
    upserted += 1;
  }

  return { skipped: false, upserted };
};

export const recommendActionsForPattern = async (input: {
  organizationId: string;
  patternFingerprint?: string | null;
  projectId?: string | null;
}): Promise<
  Array<{
    actionKey: string;
    recommendationConfidence: number;
    successCount: number;
    failureCount: number;
    riskLevel: string;
    note: string;
  }>
> => {
  if (!isLearningStageEnabled("PREVENTIVE_RECOMMENDATIONS")) {
    return [];
  }

  const rows = await prisma.remediationPatternOutcome.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.patternFingerprint
        ? { patternFingerprint: input.patternFingerprint }
        : {})
    },
    orderBy: { recommendationConfidence: "desc" },
    take: 20
  });

  return rows
    .filter((row) => row.recommendationConfidence >= 0.4 && row.successCount >= 2)
    .filter((row) => {
      const action = getUniversalAction(row.actionKey);
      return action && action.riskLevel !== "HIGH" && action.riskLevel !== "CRITICAL";
    })
    .map((row) => ({
      actionKey: row.actionKey,
      recommendationConfidence: row.recommendationConfidence,
      successCount: row.successCount,
      failureCount: row.failureCount,
      riskLevel: row.riskLevel,
      note: "Learned from verified remediation outcomes within this organisation only"
    }));
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};
