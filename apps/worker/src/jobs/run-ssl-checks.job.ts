import { randomUUID } from "crypto";
import tls from "tls";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { resolveSafeOutboundTarget } from "../lib/outbound-url-safety";
import { dispatchAlertNotifications } from "../services/notifications/notification.service";

const SSL_WARN_DAYS = 30;
const SSL_CRIT_DAYS = 7;

const getCertExpiryDays = (
  hostname: string,
  address: string,
  port: number,
  timeoutMs: number
): Promise<number> => {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: address, port, servername: hostname, rejectUnauthorized: true },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) {
          reject(new Error("No certificate found"));
          return;
        }
        const expiryMs = new Date(cert.valid_to).getTime();
        const daysLeft = Math.floor((expiryMs - Date.now()) / 86_400_000);
        resolve(daysLeft);
      }
    );
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error(`TLS connection timed out after ${timeoutMs}ms`));
    });
    socket.on("error", reject);
  });
};

const describeSslTargetFailure = (targetUrl: string, error: unknown): string => {
  const errorText = error instanceof Error ? error.message : String(error);
  return [
    `SSL check failed for ${targetUrl || "empty URL"}.`,
    "Use a public https:// URL for SSL expiry checks, or disable the SSL check for HTTP/local services.",
    `Cause: ${errorText}`
  ].join(" ");
};

const upsertSslAlert = async (input: {
  projectId: string;
  serviceId: string;
  checkId: string;
  category: "DEPENDENCY_CHANGE";
  severity: "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  message: string;
}): Promise<void> => {
  const existing = await prisma.alert.findFirst({
    where: { projectId: input.projectId, serviceId: input.serviceId, sourceType: "CHECK", sourceId: input.checkId, status: "OPEN" }
  });

  if (existing) {
    const updated = await prisma.alert.update({
      where: { id: existing.id },
      data: { severity: input.severity, category: input.category, message: input.message, lastSeenAt: new Date() }
    });
    if (updated.severity !== existing.severity) {
      await dispatchAlertNotifications(updated.id, "escalated");
    }
  } else {
    const created = await prisma.alert.create({
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
    await dispatchAlertNotifications(created.id, "triggered");
  }
};

export const runSslChecksJob = async (
  options: { projectId?: string; checkIds?: string[] } = {}
): Promise<void> => {
  const checks = await prisma.check.findMany({
    where: {
      isActive: true,
      type: "SSL",
      ...(options.checkIds?.length ? { id: { in: options.checkIds } } : {}),
      ...(options.projectId ? { Service: { projectId: options.projectId } } : {})
    },
    include: { Service: { include: { Project: true } } }
  });

  logger.info(`Running SSL checks for ${checks.length} check(s)`);

  for (const check of checks) {
    const targetUrl = check.Service.baseUrl || "";
    let daysLeft = 0;
    let status: "PASS" | "WARN" | "FAIL" = "PASS";
    let message = "";
    const checkConfig = check.configJson && typeof check.configJson === "object"
      ? check.configJson as Record<string, unknown>
      : {};
    const managedConnectionId =
      (checkConfig.source === "CONNECTION" || checkConfig.source === "URL_ONBOARDING") &&
      typeof checkConfig.connectionId === "string"
        ? checkConfig.connectionId
        : null;

    try {
      const safeTarget = await resolveSafeOutboundTarget(targetUrl, { requireHttps: true });
      const parsed = safeTarget.url;
      const hostname = parsed.hostname;
      const port = parsed.port ? Number(parsed.port) : 443;
      daysLeft = await getCertExpiryDays(hostname, safeTarget.addresses[0]!, port, check.timeoutMs);

      if (daysLeft <= 0) {
        status = "FAIL";
        message = `SSL certificate EXPIRED`;
      } else if (daysLeft <= SSL_CRIT_DAYS) {
        status = "FAIL";
        message = `SSL certificate expires in ${daysLeft} day(s)`;
      } else if (daysLeft <= SSL_WARN_DAYS) {
        status = "WARN";
        message = `SSL certificate expires in ${daysLeft} day(s)`;
      } else {
        message = `SSL certificate valid, ${daysLeft} days remaining`;
      }
    } catch (error) {
      status = "FAIL";
      message = describeSslTargetFailure(targetUrl, error);
    }

    await prisma.checkResult.create({
      data: {
        id: randomUUID(),
        checkId: check.id,
        status,
        message,
        rawJson: { daysLeft, checkedAt: new Date().toISOString() }
      }
    });

    await prisma.service.update({
      where: { id: check.serviceId },
      data: { status: status === "PASS" ? "HEALTHY" : status === "WARN" ? "DEGRADED" : "DOWN", updatedAt: new Date() }
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
              validationErrorCategory: null,
              updatedAt: new Date()
            }
          : {
              health: "DEGRADED",
              healthReason: message,
              installationStatus: "ERROR",
              lastFailureAt: new Date(),
              lastError: message,
              validationErrorCategory: "TLS_FAILED",
              updatedAt: new Date()
            }
      });
    }

    if (status !== "PASS") {
      const severity = status === "FAIL" ? (daysLeft <= SSL_CRIT_DAYS ? "CRITICAL" : "HIGH") : "MEDIUM";
      await upsertSslAlert({
        projectId: check.Service.projectId,
        serviceId: check.serviceId,
        checkId: check.id,
        category: "DEPENDENCY_CHANGE",
        severity,
        title: `${check.name} failing`,
        message
      });
    } else {
      const recentResults = await prisma.checkResult.findMany({
        where: { checkId: check.id },
        orderBy: { checkedAt: "desc" },
        take: Math.max(1, check.recoveryThreshold)
      });
      const recovered =
        recentResults.length >= check.recoveryThreshold &&
        recentResults.every((result) => result.status === "PASS");
      const openAlerts = recovered
        ? await prisma.alert.findMany({
            where: { sourceType: "CHECK", sourceId: check.id, status: "OPEN" },
            select: { id: true }
          })
        : [];

      for (const openAlert of openAlerts) {
        await prisma.alert.update({
          where: { id: openAlert.id },
          data: { status: "RESOLVED", resolvedAt: new Date(), lastSeenAt: new Date() }
        });
        await dispatchAlertNotifications(openAlert.id, "resolved");
      }
    }
  }
};
