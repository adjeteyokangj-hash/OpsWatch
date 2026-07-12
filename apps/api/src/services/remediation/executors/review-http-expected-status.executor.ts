import { classifyHttpCheckFailure, formatFailureMessage } from "@opswatch/shared";
import { prisma } from "../../../lib/prisma";
import { randomUUID } from "crypto";
import type { RemediationExecutor } from "../types";
import { completed, failed } from "./_common";
import { redactUnknown } from "../../../lib/redact-secrets";

const loadCheck = async (context: {
  organizationId: string;
  checkId?: string;
  serviceId?: string;
}) => {
  if (!context.organizationId) return null;
  return prisma.check.findFirst({
    where: {
      isActive: true,
      type: "HTTP",
      Service: { Project: { organizationId: context.organizationId } },
      ...(context.checkId ? { id: context.checkId } : {}),
      ...(context.serviceId ? { serviceId: context.serviceId } : {})
    },
    include: { Service: { include: { Project: true } } },
    orderBy: { updatedAt: "desc" }
  });
};

const runVerification = async (check: {
  id: string;
  serviceId: string;
  expectedStatusCode: number | null;
  timeoutMs: number;
  Service: { baseUrl: string | null; projectId: string; name: string };
}): Promise<{ passed: boolean; responseCode: number | null; message: string }> => {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), check.timeoutMs);
    const response = await fetch(check.Service.baseUrl || "", { signal: controller.signal });
    clearTimeout(timeout);
    const responseCode = response.status;
    if (check.expectedStatusCode && responseCode !== check.expectedStatusCode) {
      return {
        passed: false,
        responseCode,
        message: formatFailureMessage(
          classifyHttpCheckFailure({
            checkType: "HTTP",
            expectedStatusCode: check.expectedStatusCode,
            actualStatusCode: responseCode
          })
        )
      };
    }
    return {
      passed: true,
      responseCode,
      message: `Verification passed with HTTP ${responseCode} in ${Date.now() - start}ms`
    };
  } catch (error) {
    return {
      passed: false,
      responseCode: null,
      message: formatFailureMessage(classifyHttpCheckFailure({ error }))
    };
  }
};

const safeWriteTimeline = async (input: {
  incidentId: string;
  projectId: string;
  summary: string;
  sourceId?: string;
  payload?: Record<string, unknown>;
}): Promise<void> => {
  try {
    await prisma.incidentTimelineEvent.create({
      data: {
        id: randomUUID(),
        incidentId: input.incidentId,
        projectId: input.projectId,
        eventType: "REMEDIATION",
        summary: input.summary,
        sourceType: "REMEDIATION",
        sourceId: input.sourceId,
        payloadJson: redactUnknown(input.payload ?? {}) as object
      }
    });
  } catch {
    // Timeline write failure must not mask remediation outcome.
  }
};

const safeWriteAudit = async (input: {
  userId?: string | null;
  action: string;
  entityId: string;
  metadata: Record<string, unknown>;
}): Promise<void> => {
  try {
    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        userId: input.userId ?? null,
        action: input.action,
        entityType: "CHECK",
        entityId: input.entityId,
        metadataJson: redactUnknown(input.metadata) as object
      }
    });
  } catch {
    // Audit failure must not mask remediation outcome.
  }
};

export const executeReviewHttpExpectedStatus: RemediationExecutor = async ({
  context,
  executedBy
}) => {
  if (!context.incidentId) {
    return failed("incidentId is required for REVIEW_HTTP_EXPECTED_STATUS");
  }

  if (!context.organizationId) {
    return failed("organizationId is required for REVIEW_HTTP_EXPECTED_STATUS");
  }

  const check = await loadCheck({
    organizationId: context.organizationId,
    checkId: context.checkId,
    serviceId: context.serviceId
  });
  if (!check) {
    return failed("No active HTTP check found for the provided context.");
  }

  const recentResults = await prisma.checkResult.findMany({
    where: { checkId: check.id },
    orderBy: { checkedAt: "desc" },
    take: 8,
    select: {
      id: true,
      status: true,
      responseCode: true,
      message: true,
      checkedAt: true
    }
  });

  const latestFailure = recentResults.find((row) => row.status === "FAIL");
  const actualStatusCode =
    typeof context.extra?.actualStatusCode === "number"
      ? context.extra.actualStatusCode
      : latestFailure?.responseCode ?? recentResults[0]?.responseCode ?? null;

  const preview = {
    checkId: check.id,
    checkName: check.name,
    serviceId: check.serviceId,
    serviceName: check.Service.name,
    currentExpectedStatus: check.expectedStatusCode,
    recentActualStatus: actualStatusCode,
    recentResults: recentResults.map((row) => ({
      status: row.status,
      responseCode: row.responseCode,
      message: row.message,
      checkedAt: row.checkedAt.toISOString()
    })),
    riskExplanation:
      "Changing the expected HTTP status alters monitoring policy and can hide genuine deployment or configuration regressions. Only approve when the endpoint is intentionally healthy at the received status."
  };

  const newExpectedStatusCode =
    typeof context.extra?.newExpectedStatusCode === "number"
      ? context.extra.newExpectedStatusCode
      : actualStatusCode;

  if (!newExpectedStatusCode || newExpectedStatusCode < 100 || newExpectedStatusCode > 599) {
    return failed("A valid newExpectedStatusCode (100-599) is required in context.extra.", {
      ...preview,
      missingFields: ["extra.newExpectedStatusCode"]
    });
  }

  const approvalReason =
    typeof context.extra?.approvalReason === "string" ? context.extra.approvalReason.trim() : "";
  if (!approvalReason) {
    return failed("approvalReason is required before changing expected HTTP status.", preview);
  }

  const previousExpectedStatus = check.expectedStatusCode;
  const changedAt = new Date();

  await safeWriteTimeline({
    incidentId: context.incidentId,
    projectId: check.Service.projectId,
    sourceId: check.id,
    summary: `Approved review of expected HTTP status for ${check.name}: ${previousExpectedStatus ?? "unset"} → ${newExpectedStatusCode}`,
    payload: {
      step: "APPROVED",
      action: "REVIEW_HTTP_EXPECTED_STATUS",
      previousExpectedStatus,
      attemptedExpectedStatus: newExpectedStatusCode,
      approvalReason
    }
  });

  await prisma.check.update({
    where: { id: check.id },
    data: { expectedStatusCode: newExpectedStatusCode, updatedAt: changedAt }
  });

  await safeWriteTimeline({
    incidentId: context.incidentId,
    projectId: check.Service.projectId,
    sourceId: check.id,
    summary: `Expected HTTP status updated for ${check.name} to ${newExpectedStatusCode}`,
    payload: { step: "CONFIG_UPDATED", action: "REVIEW_HTTP_EXPECTED_STATUS", newExpectedStatus: newExpectedStatusCode }
  });

  const verification = await runVerification({
    ...check,
    expectedStatusCode: newExpectedStatusCode
  });

  await prisma.checkResult.create({
    data: {
      id: randomUUID(),
      checkId: check.id,
      status: verification.passed ? "PASS" : "FAIL",
      responseCode: verification.responseCode ?? undefined,
      responseTimeMs: 0,
      message: verification.message,
      rawJson: redactUnknown({
        source: "review_http_expected_status_verification",
        previousExpectedStatus,
        newExpectedStatus: newExpectedStatusCode,
        approvalReason,
        approvedBy: executedBy ?? null,
        changedAt: changedAt.toISOString()
      }) as object
    }
  });

  await safeWriteTimeline({
    incidentId: context.incidentId,
    projectId: check.Service.projectId,
    sourceId: check.id,
    summary: verification.passed
      ? `Verification passed after expected HTTP status change for ${check.name}`
      : `Verification failed after expected HTTP status change for ${check.name}`,
    payload: {
      step: "VERIFICATION",
      action: "REVIEW_HTTP_EXPECTED_STATUS",
      passed: verification.passed,
      responseCode: verification.responseCode,
      message: verification.message
    }
  });

  if (!verification.passed) {
    await prisma.check.update({
      where: { id: check.id },
      data: { expectedStatusCode: previousExpectedStatus, updatedAt: new Date() }
    });

    const restored = await prisma.check.findUnique({
      where: { id: check.id },
      select: { expectedStatusCode: true }
    });

    await safeWriteAudit({
      userId: executedBy ?? null,
      action: "HTTP_EXPECTED_STATUS_ROLLBACK",
      entityId: check.id,
      metadata: {
        incidentId: context.incidentId,
        previousExpectedStatus,
        attemptedExpectedStatus: newExpectedStatusCode,
        restoredExpectedStatus: restored?.expectedStatusCode ?? previousExpectedStatus,
        approvalReason,
        verificationMessage: verification.message,
        rolledBackAt: new Date().toISOString()
      }
    });

    await safeWriteTimeline({
      incidentId: context.incidentId,
      projectId: check.Service.projectId,
      sourceId: check.id,
      summary: `HTTP expected status rolled back to ${restored?.expectedStatusCode ?? previousExpectedStatus ?? "unset"} after verification failed for ${check.name}`,
      payload: {
        step: "ROLLBACK",
        action: "REVIEW_HTTP_EXPECTED_STATUS",
        previousExpectedStatus,
        attemptedExpectedStatus: newExpectedStatusCode,
        restoredExpectedStatus: restored?.expectedStatusCode ?? previousExpectedStatus,
        verificationMessage: verification.message
      }
    });

    return failed(
      `Verification failed after updating expected status. Configuration rolled back to ${previousExpectedStatus ?? "unset"}.`,
      {
        ...preview,
        rolledBack: true,
        previousExpectedStatus,
        attemptedExpectedStatus: newExpectedStatusCode,
        restoredExpectedStatus: restored?.expectedStatusCode ?? previousExpectedStatus,
        verification
      }
    );
  }

  await safeWriteAudit({
    userId: executedBy ?? null,
    action: "HTTP_EXPECTED_STATUS_CHANGED",
    entityId: check.id,
    metadata: {
      incidentId: context.incidentId,
      previousExpectedStatus,
      newExpectedStatus: newExpectedStatusCode,
      approvalReason,
      approvedBy: executedBy ?? null,
      changedAt: changedAt.toISOString(),
      verificationMessage: verification.message
    }
  });

  await safeWriteTimeline({
    incidentId: context.incidentId,
    projectId: check.Service.projectId,
    sourceId: check.id,
    summary: `Expected HTTP status for ${check.name} changed ${previousExpectedStatus ?? "unset"} → ${newExpectedStatusCode} and verified`,
    payload: {
      step: "COMPLETED",
      action: "REVIEW_HTTP_EXPECTED_STATUS",
      previousExpectedStatus,
      newExpectedStatus: newExpectedStatusCode,
      approvalReason,
      approvedBy: executedBy ?? null,
      verification
    }
  });

  return completed(
    `Expected HTTP status updated to ${newExpectedStatusCode} and verified successfully.`,
    {
      ...preview,
      previousExpectedStatus,
      newExpectedStatus: newExpectedStatusCode,
      approvalReason,
      approvedBy: executedBy ?? null,
      changedAt: changedAt.toISOString(),
      verification
    }
  );
};
