import tls from "tls";
import { randomUUID } from "crypto";
import { URL } from "url";
import { prisma } from "../../../lib/prisma";
import type { RemediationExecutor } from "../types";
import { createAlert, resolveAlertsBySourceType } from "../../alerting.service";
import { completed, failed } from "./_common";

const SSL_WARN_DAYS = 30;
const SSL_CRIT_DAYS = 7;

const getCertExpiryDays = (hostname: string, port: number, timeoutMs: number): Promise<number> =>
  new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: hostname, port, servername: hostname, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert?.valid_to) {
          reject(new Error("No certificate found"));
          return;
        }
        const expiryMs = new Date(cert.valid_to).getTime();
        resolve(Math.floor((expiryMs - Date.now()) / 86_400_000));
      }
    );
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error(`TLS connection timed out after ${timeoutMs}ms`));
    });
    socket.on("error", reject);
  });

export const executeRerunSslCheck: RemediationExecutor = async ({ context }) => {
  const check = await prisma.check.findFirst({
    where: {
      isActive: true,
      type: "SSL",
      ...(context.checkId ? { id: context.checkId } : {}),
      ...(context.serviceId ? { serviceId: context.serviceId } : {})
    },
    include: { Service: { include: { Project: true } } },
    orderBy: { updatedAt: "desc" }
  });

  if (!check) {
    return failed("No active SSL check found for the provided context.");
  }

  const targetUrl = check.Service.baseUrl || "";
  let daysLeft = 0;
  let status: "PASS" | "WARN" | "FAIL" = "PASS";
  let message = "";

  try {
    const parsed = new URL(targetUrl);
    const hostname = parsed.hostname;
    const port = parsed.port ? Number(parsed.port) : 443;
    daysLeft = await getCertExpiryDays(hostname, port, check.timeoutMs);

    if (daysLeft <= 0) {
      status = "FAIL";
      message = "SSL certificate EXPIRED";
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
    message = `SSL check failed: ${String(error)}`;
  }

  await prisma.checkResult.create({
    data: {
      id: randomUUID(),
      checkId: check.id,
      status,
      message,
      rawJson: { source: "remediation_rerun", daysLeft, checkedAt: new Date().toISOString() }
    }
  });

  if (status === "PASS") {
    await resolveAlertsBySourceType(check.Service.projectId, "CHECK", `${check.name} SSL expiry warning`);
    return completed(`SSL check rerun passed (${check.name}).`, { checkId: check.id, daysLeft });
  }

  await createAlert({
    projectId: check.Service.projectId,
    serviceId: check.serviceId,
    sourceType: "CHECK",
    sourceId: check.id,
    severity: status === "FAIL" ? (daysLeft <= SSL_CRIT_DAYS ? "CRITICAL" : "HIGH") : "MEDIUM",
    category: "DEPENDENCY_CHANGE",
    title: `${check.name} SSL expiry warning`,
    message
  });

  return failed(`SSL check rerun not healthy (${check.name}): ${message}`, {
    checkId: check.id,
    daysLeft,
    status
  });
};
