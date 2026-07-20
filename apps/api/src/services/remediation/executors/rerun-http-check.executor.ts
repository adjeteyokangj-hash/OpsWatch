import { classifyHttpCheckFailure, formatFailureMessage } from "@opswatch/shared";
import { prisma } from "../../../lib/prisma";
import { randomUUID } from "crypto";
import type { RemediationExecutor } from "../types";
import { createAlert } from "../../alerting.service";
import { completed, failed } from "./_common";
import { propagateCheckRecovery } from "../check-recovery-propagation.service";

export const executeRerunHttpCheck: RemediationExecutor = async ({ context, executedBy }) => {
  const check = await prisma.check.findFirst({
    where: {
      isActive: true,
      type: { in: ["HTTP", "KEYWORD", "RESPONSE_TIME"] },
      ...(context.checkId ? { id: context.checkId } : {}),
      ...(context.serviceId ? { serviceId: context.serviceId } : {})
    },
    include: { Service: { include: { Project: true } } },
    orderBy: { updatedAt: "desc" }
  });

  if (!check) {
    return failed("No active HTTP/keyword/latency check found for the provided context.");
  }

  const start = Date.now();
  let status: "PASS" | "FAIL" = "PASS";
  let responseCode: number | null = null;
  let message = "OK";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), check.timeoutMs);
    const response = await fetch(check.Service.baseUrl || "", { signal: controller.signal });
    clearTimeout(timeout);
    responseCode = response.status;

    if (check.type === "HTTP") {
      if (check.expectedStatusCode && response.status !== check.expectedStatusCode) {
        status = "FAIL";
        message = formatFailureMessage(
          classifyHttpCheckFailure({
            checkType: "HTTP",
            expectedStatusCode: check.expectedStatusCode,
            actualStatusCode: response.status
          })
        );
      }
    } else if (check.type === "KEYWORD") {
      const body = await response.text();
      const keyword = check.expectedKeyword || "";
      if (!keyword) {
        status = "FAIL";
        message = "No keyword configured";
      } else if (!body.includes(keyword)) {
        status = "FAIL";
        message = `Keyword "${keyword}" not found in response`;
      } else {
        message = `Keyword "${keyword}" found`;
      }
    } else {
      const responseTimeMs = Date.now() - start;
      const config = check.configJson as { maxResponseTimeMs?: number } | null;
      const threshold = config?.maxResponseTimeMs ?? 3000;
      if (responseTimeMs > threshold) {
        status = "FAIL";
        message = `Response time ${responseTimeMs}ms exceeds threshold ${threshold}ms`;
      } else {
        message = `Response time ${responseTimeMs}ms within threshold ${threshold}ms`;
      }
    }
  } catch (error) {
    status = "FAIL";
    message = formatFailureMessage(classifyHttpCheckFailure({ error }));
  }

  const responseTimeMs = Date.now() - start;
  const failureMeta =
    status === "FAIL"
      ? classifyHttpCheckFailure({
          checkType: check.type,
          expectedStatusCode: check.expectedStatusCode,
          actualStatusCode: responseCode ?? undefined,
          message
        })
      : null;

  const resultId = randomUUID();
  await prisma.checkResult.create({
    data: {
      id: resultId,
      checkId: check.id,
      status,
      responseCode: responseCode ?? undefined,
      responseTimeMs,
      message,
      rawJson: {
        source: "remediation_rerun",
        url: check.Service.baseUrl,
        checkedAt: new Date().toISOString(),
        ...(failureMeta
          ? {
              failureClass: failureMeta.failureClass,
              diagnosis: failureMeta.diagnosis,
              possibleCauses: failureMeta.possibleCauses
            }
          : {})
      }
    }
  });

  const correlationId = `check-rerun:${resultId}`;
  const rootCauseHint =
    failureMeta?.diagnosis ??
    (check.type === "KEYWORD"
      ? `${check.name} failed because the expected payload keyword was temporarily missing or unavailable.`
      : `${check.name} failed verification against the monitored endpoint.`);

  const recovery = await propagateCheckRecovery({
    organizationId: context.organizationId,
    projectId: check.Service.projectId,
    checkId: check.id,
    alertId: context.alertId,
    incidentId: context.incidentId,
    serviceId: check.serviceId,
    correlationId,
    recoveryCause: executedBy && executedBy !== "auto-heal" ? "administrator-approved" : "automatic",
    actorUserId: executedBy && executedBy !== "auto-heal" ? executedBy : null,
    checkFailed: status !== "PASS",
    rootCauseHint: status === "PASS" ? rootCauseHint : failureMeta?.diagnosis ?? rootCauseHint
  });

  if (status === "PASS") {
    return completed(`Check rerun passed (${check.name}). ${recovery.uiLabel}`, {
      checkId: check.id,
      status,
      responseTimeMs,
      checkResultId: resultId,
      recovery,
      verificationProgress: recovery.verification,
      recoveryUiState: recovery.uiState,
      recoveryUiLabel: recovery.uiLabel,
      executedAt: new Date().toISOString(),
      triggeredBy: executedBy ?? "system"
    });
  }

  const category = check.type === "RESPONSE_TIME" ? "PERFORMANCE" : check.type === "KEYWORD" ? "RELIABILITY" : "AVAILABILITY";
  await createAlert({
    projectId: check.Service.projectId,
    serviceId: check.serviceId,
    sourceType: "CHECK",
    sourceId: check.id,
    severity: "HIGH",
    category,
    title: `${check.name} failing`,
    message
  });

  return failed(`Check rerun failed (${check.name}): ${message}`, {
    checkId: check.id,
    status,
    responseCode,
    responseTimeMs,
    checkResultId: resultId,
    recovery,
    verificationProgress: recovery.verification,
    recoveryUiState: recovery.uiState,
    recoveryUiLabel: recovery.uiLabel,
    executedAt: new Date().toISOString(),
    triggeredBy: executedBy ?? "system"
  });
};
