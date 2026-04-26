import { prisma } from "../../../lib/prisma";
import { randomUUID } from "crypto";
import type { RemediationExecutor } from "../types";
import { createAlert, resolveAlertsBySourceType } from "../../alerting.service";
import { completed, failed } from "./_common";

export const executeRerunHttpCheck: RemediationExecutor = async ({ context }) => {
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
        message = `Expected ${check.expectedStatusCode} got ${response.status}`;
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
    message = `HTTP request failed: ${String(error)}`;
  }

  const responseTimeMs = Date.now() - start;

  await prisma.checkResult.create({
    data: {
      id: randomUUID(),
      checkId: check.id,
      status,
      responseCode: responseCode ?? undefined,
      responseTimeMs,
      message,
      rawJson: {
        source: "remediation_rerun",
        url: check.Service.baseUrl,
        checkedAt: new Date().toISOString()
      }
    }
  });

  if (status === "PASS") {
    await resolveAlertsBySourceType(check.Service.projectId, "CHECK", `${check.name} failing`);
    return completed(`Check rerun passed (${check.name}).`, { checkId: check.id, status, responseTimeMs });
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
    responseTimeMs
  });
};
