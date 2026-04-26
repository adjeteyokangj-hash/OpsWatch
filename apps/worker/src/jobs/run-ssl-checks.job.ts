import { randomUUID } from "crypto";
import tls from "tls";
import { URL } from "url";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { dispatchAlertNotifications } from "../services/notifications/notification.service";

const SSL_WARN_DAYS = 30;
const SSL_CRIT_DAYS = 7;

const getCertExpiryDays = (hostname: string, port: number, timeoutMs: number): Promise<number> => {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: hostname, port, servername: hostname, rejectUnauthorized: false },
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

export const runSslChecksJob = async (): Promise<void> => {
  const checks = await prisma.check.findMany({
    where: { isActive: true, type: "SSL" },
    include: { Service: { include: { Project: true } } }
  });

  logger.info(`Running SSL checks for ${checks.length} check(s)`);

  for (const check of checks) {
    const targetUrl = check.Service.baseUrl || "";
    let daysLeft = 0;
    let status: "PASS" | "WARN" | "FAIL" = "PASS";
    let message = "";

    try {
      const parsed = new URL(targetUrl);
      if (parsed.protocol !== "https:") {
        throw new Error(`SSL checks require https:// URLs; received ${parsed.protocol || "unknown protocol"}`);
      }
      const hostname = parsed.hostname;
      const port = parsed.port ? Number(parsed.port) : 443;
      daysLeft = await getCertExpiryDays(hostname, port, check.timeoutMs);

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

    if (status !== "PASS") {
      const severity = status === "FAIL" ? (daysLeft <= SSL_CRIT_DAYS ? "CRITICAL" : "HIGH") : "MEDIUM";
      await upsertSslAlert({
        projectId: check.Service.projectId,
        serviceId: check.serviceId,
        checkId: check.id,
        category: "DEPENDENCY_CHANGE",
        severity,
        title: `${check.name} SSL expiry warning`,
        message
      });
    } else {
      const openAlerts = await prisma.alert.findMany({
        where: { sourceType: "CHECK", sourceId: check.id, status: "OPEN" },
        select: { id: true }
      });

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
