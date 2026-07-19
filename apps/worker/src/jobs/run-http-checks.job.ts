import { randomUUID } from "crypto";
import { classifyHttpCheckFailure, formatFailureMessage } from "@opswatch/shared";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { connectionRequestHeaders } from "../lib/connection-auth";
import { resolveSafeOutboundTarget } from "../lib/outbound-url-safety";
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

const fetchWithSafeRedirects = async (input: {
  target: string;
  headers: Record<string, string>;
  signal: AbortSignal;
}): Promise<{ response: Response; finalUrl: string; redirects: string[] }> => {
  const initial = await resolveSafeOutboundTarget(input.target);
  let current = initial.url;
  const initialOrigin = current.origin;
  const visited = new Set([current.toString()]);
  const redirects: string[] = [];

  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const response = await fetch(current.toString(), {
      signal: input.signal,
      headers: current.origin === initialOrigin ? input.headers : {},
      redirect: "manual"
    });
    if (response.status < 300 || response.status >= 400 || !response.headers.get("location")) {
      return { response, finalUrl: current.toString(), redirects };
    }
    if (redirectCount === 5) throw new Error("Redirect limit exceeded");
    const nextUrl = new URL(response.headers.get("location")!, current);
    const safeNext = await resolveSafeOutboundTarget(nextUrl.toString());
    const normalizedNext = safeNext.url.toString();
    if (visited.has(normalizedNext)) throw new Error("Redirect loop detected");
    visited.add(normalizedNext);
    redirects.push(normalizedNext);
    current = safeNext.url;
  }

  throw new Error("Redirect limit exceeded");
};

export const runHttpChecksJob = async (
  options: { projectId?: string; checkIds?: string[] } = {}
): Promise<void> => {
  const checks = await prisma.check.findMany({
    where: {
      isActive: true,
      type: { in: ["HTTP", "KEYWORD", "RESPONSE_TIME"] },
      ...(options.checkIds?.length ? { id: { in: options.checkIds } } : {}),
      ...(options.projectId ? { Service: { projectId: options.projectId } } : {})
    },
    include: { Service: { include: { Project: true } } }
  });

  for (const check of checks) {
    const start = Date.now();
    let status: "PASS" | "FAIL" = "PASS";
    let responseCode: number | null = null;
    let message = "OK";
    let managedConnectionId: string | null = null;
    let finalUrl: string | null = null;
    let redirects: string[] = [];
    let timeout: NodeJS.Timeout | null = null;

    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), check.timeoutMs);
      const checkConfig = check.configJson && typeof check.configJson === "object"
        ? check.configJson as Record<string, unknown>
        : {};
      let headers: Record<string, string> = {};
      if (
        (checkConfig.source === "CONNECTION" || checkConfig.source === "URL_ONBOARDING") &&
        typeof checkConfig.connectionId === "string"
      ) {
        const connection = await prisma.connection.findFirst({
          where: {
            id: checkConfig.connectionId,
            linkedCheckId: check.id,
            isActive: true,
            Project: { id: check.Service.projectId, organizationId: check.Service.Project.organizationId }
          },
          select: {
            id: true,
            authMethod: true,
            secretRef: true,
            managedSecretCiphertext: true,
            managedSecretIv: true,
            managedSecretAuthTag: true,
            configurationJson: true
          }
        });
        if (!connection) throw new Error("Managed connection is inactive or outside the check project");
        managedConnectionId = connection.id;
        headers = connectionRequestHeaders(connection);
      }
      const fetched = await fetchWithSafeRedirects({
        target: check.Service.baseUrl || "",
        headers,
        signal: controller.signal
      });
      const response = fetched.response;
      finalUrl = fetched.finalUrl;
      redirects = fetched.redirects;
      responseCode = response.status;

      if (check.type === "HTTP") {
        const acceptedStatusMin =
          typeof checkConfig.acceptedStatusMin === "number" ? checkConfig.acceptedStatusMin : null;
        const acceptedStatusMax =
          typeof checkConfig.acceptedStatusMax === "number" ? checkConfig.acceptedStatusMax : null;
        const outsideAcceptedRange =
          acceptedStatusMin !== null &&
          acceptedStatusMax !== null &&
          (response.status < acceptedStatusMin || response.status > acceptedStatusMax);
        if (
          outsideAcceptedRange ||
          (acceptedStatusMin === null && check.expectedStatusCode && response.status !== check.expectedStatusCode)
        ) {
          status = "FAIL";
          const classification = classifyHttpCheckFailure({
            checkType: "HTTP",
            expectedStatusCode: check.expectedStatusCode,
            actualStatusCode: response.status
          });
          message = formatFailureMessage(classification);
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
          message = formatFailureMessage(
            classifyHttpCheckFailure({
              checkType: "RESPONSE_TIME",
              message: `Response time ${responseTimeMs}ms exceeds threshold ${threshold}ms`
            })
          );
        } else {
          message = `Response time ${responseTimeMs}ms within threshold ${threshold}ms`;
        }
      }
    } catch (error) {
      status = "FAIL";
      message = formatFailureMessage(classifyHttpCheckFailure({ error, message: describeHttpTargetFailure(check.Service.baseUrl || "", error) }));
    } finally {
      if (timeout) clearTimeout(timeout);
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
          finalUrl,
          redirects,
          checkedAt: new Date().toISOString(),
          ...(failureMeta
            ? {
                failureClass: failureMeta.failureClass,
                diagnosis: failureMeta.diagnosis,
                possibleCauses: failureMeta.possibleCauses,
                expectedStatusCode: failureMeta.expectedStatusCode,
                actualStatusCode: failureMeta.actualStatusCode
              }
            : {})
        }
      }
    });

    await prisma.service.update({
      where: { id: check.serviceId },
      data: { status: status === "PASS" ? "HEALTHY" : "DOWN", updatedAt: new Date() }
    });
    if (managedConnectionId) {
      await prisma.connection.updateMany({
        where: {
          id: managedConnectionId,
          organizationId: check.Service.Project.organizationId ?? undefined,
          projectId: check.Service.projectId,
          isActive: true
        },
        data: status === "PASS"
          ? {
              health: "HEALTHY",
              healthReason: null,
              installationStatus: "CONNECTED",
              lastSuccessAt: new Date(),
              lastError: null,
              validationStatusCode: responseCode,
              validationLatencyMs: responseTimeMs,
              validationErrorCategory: null,
              updatedAt: new Date()
            }
          : {
              health: "DEGRADED",
              healthReason: message,
              installationStatus: "ERROR",
              lastFailureAt: new Date(),
              lastError: message,
              validationStatusCode: responseCode,
              validationLatencyMs: responseTimeMs,
              validationErrorCategory: failureMeta?.failureClass ?? "INVALID_RESPONSE",
              updatedAt: new Date()
            }
      });
    }

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
      const recentResults = await prisma.checkResult.findMany({
        where: { checkId: check.id },
        orderBy: { checkedAt: "desc" },
        take: Math.max(1, check.recoveryThreshold)
      });
      const recovered =
        recentResults.length >= check.recoveryThreshold &&
        recentResults.every((result) => result.status === "PASS");
      if (recovered) await resolveCheckAlerts(check.id);
    }
  }

  logger.info(`Processed ${checks.length} HTTP checks`);
};
