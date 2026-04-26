import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { dispatchAlertNotifications } from "../services/notifications/notification.service";

const upsertCheckAlert = async (input: {
  projectId: string;
  serviceId: string;
  checkId: string;
  category: "AVAILABILITY" | "RELIABILITY" | "PERFORMANCE";
  severity: "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  message: string;
}): Promise<void> => {
  let alertToDispatchId: string | null = null;
  const existingAlert = await prisma.alert.findFirst({
    where: {
      projectId: input.projectId,
      serviceId: input.serviceId,
      sourceType: "CHECK",
      sourceId: input.checkId,
      title: input.title,
      status: "OPEN"
    }
  });

  if (existingAlert) {
    const updatedAlert = await prisma.alert.update({
      where: { id: existingAlert.id },
      data: {
        severity: input.severity,
        category: input.category,
        message: input.message,
        lastSeenAt: new Date()
      }
    });
    if (updatedAlert.severity !== existingAlert.severity) {
      alertToDispatchId = updatedAlert.id;
    }
  } else {
    const createdAlert = await prisma.alert.create({
      data: {
        id: randomUUID(),
        projectId: input.projectId,
        serviceId: input.serviceId,
        sourceType: "CHECK",
        sourceId: input.checkId,
        severity: input.severity,
        category: input.category,
        title: input.title,
        message: input.message
      }
    });
    alertToDispatchId = createdAlert.id;
  }

  if (alertToDispatchId) {
    await dispatchAlertNotifications(alertToDispatchId, "triggered");
  }
};

const resolveCheckAlerts = async (checkId: string): Promise<void> => {
  const openAlerts = await prisma.alert.findMany({
    where: {
      sourceType: "CHECK",
      sourceId: checkId,
      status: "OPEN"
    },
    select: { id: true }
  });

  for (const openAlert of openAlerts) {
    await prisma.alert.update({
      where: { id: openAlert.id },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        lastSeenAt: new Date()
      }
    });
    await dispatchAlertNotifications(openAlert.id, "resolved");
  }
};

const describeHttpTargetFailure = (targetUrl: string, error: unknown): string => {
  const cause = error instanceof Error && "cause" in error ? (error.cause as { code?: string; message?: string } | undefined) : undefined;
  const causeText = cause?.code || cause?.message || (error instanceof Error ? error.message : String(error));
  return [
    `HTTP request failed for ${targetUrl || "empty URL"}.`,
    "Verify the endpoint is reachable from the OpsWatch worker, DNS resolves, TLS is valid, and firewalls allow outbound traffic.",
    `Cause: ${causeText}`
  ].join(" ");
};

export const runHttpChecksJob = async (): Promise<void> => {
  const checks = await prisma.check.findMany({
    where: { isActive: true, type: { in: ["HTTP", "KEYWORD", "RESPONSE_TIME"] } },
    include: { Service: { include: { Project: true } } }
  });

  for (const check of checks) {
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
      } else if (check.type === "RESPONSE_TIME") {
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
      message = describeHttpTargetFailure(check.Service.baseUrl || "", error);
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
          url: check.Service.baseUrl,
          checkedAt: new Date().toISOString()
        }
      }
    });

    if (status === "FAIL") {
      const recentResults = await prisma.checkResult.findMany({
        where: {
          checkId: check.id
        },
        orderBy: {
          checkedAt: "desc"
        },
        take: 5
      });

      let consecutiveFailures = 0;
      for (const result of recentResults) {
        if (result.status === "FAIL") {
          consecutiveFailures += 1;
        } else {
          break;
        }
      }

      if (consecutiveFailures >= check.failureThreshold) {
        const severity = consecutiveFailures >= 5 ? "CRITICAL" : consecutiveFailures >= 3 ? "HIGH" : "MEDIUM";
        const category = check.type === "RESPONSE_TIME" ? "PERFORMANCE" : check.type === "KEYWORD" ? "RELIABILITY" : "AVAILABILITY";
        await upsertCheckAlert({
          projectId: check.Service.projectId,
          serviceId: check.serviceId,
          checkId: check.id,
          category,
          severity,
          title: `${check.name} failing`,
          message
        });
      }
    } else {
      await resolveCheckAlerts(check.id);
    }
  }

  logger.info(`Processed ${checks.length} HTTP checks`);
};
