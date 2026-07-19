import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { parseSafeExternalHttpUrl } from "@opswatch/shared";
import { prisma } from "../lib/prisma";
import { assertSafeConnectionTarget } from "./agentless-connection.service";

export type UrlMonitoringRole = "PUBLIC" | "ADMIN";

export type ProvisionUrlMonitoringInput = {
  organizationId: string;
  projectId: string;
  projectName: string;
  environment: string;
  role: UrlMonitoringRole;
  url: string;
  createdBy?: string | null;
};

export type ProvisionedUrlMonitoring = {
  connectionId: string;
  serviceId: string;
  httpCheckId: string;
  sslCheckId: string;
  url: string;
};

const displayName = (role: UrlMonitoringRole): string =>
  role === "PUBLIC" ? "Public website" : "Admin endpoint";

export const normalizeMonitoringUrl = async (input: string): Promise<string> => {
  const parsed = parseSafeExternalHttpUrl(input, { requireHttps: true });
  await assertSafeConnectionTarget(parsed.toString());
  return parsed.toString();
};

const ensureCheck = async (
  tx: Prisma.TransactionClient,
  input: {
    serviceId: string;
    connectionId: string;
    role: UrlMonitoringRole;
    type: "HTTP" | "SSL";
  }
): Promise<string> => {
  const name = `${displayName(input.role)} ${input.type === "HTTP" ? "availability" : "certificate"}`;
  const existing = await tx.check.findFirst({
    where: { serviceId: input.serviceId, type: input.type, name },
    select: { id: true }
  });
  const configJson = {
    source: "URL_ONBOARDING",
    connectionId: input.connectionId,
    monitoringRole: input.role,
    ...(input.type === "HTTP" ? { acceptedStatusMin: 200, acceptedStatusMax: 399 } : {})
  };
  if (existing) {
    await tx.check.update({
      where: { id: existing.id },
      data: {
        intervalSeconds: input.type === "HTTP" ? 60 : 600,
        timeoutMs: 10_000,
        expectedStatusCode: input.type === "HTTP" ? 200 : null,
        failureThreshold: 3,
        recoveryThreshold: 2,
        configJson,
        isActive: true,
        updatedAt: new Date()
      }
    });
    return existing.id;
  }
  const id = randomUUID();
  await tx.check.create({
    data: {
      id,
      serviceId: input.serviceId,
      name,
      type: input.type,
      intervalSeconds: input.type === "HTTP" ? 60 : 600,
      timeoutMs: 10_000,
      expectedStatusCode: input.type === "HTTP" ? 200 : null,
      failureThreshold: 3,
      recoveryThreshold: 2,
      configJson,
      isActive: true,
      updatedAt: new Date()
    }
  });
  return id;
};

export const provisionUrlMonitoring = async (
  input: ProvisionUrlMonitoringInput
): Promise<ProvisionedUrlMonitoring> => {
  const url = await normalizeMonitoringUrl(input.url);
  const name = displayName(input.role);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    let connection = await tx.connection.findFirst({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        name
      }
    });

    if (!connection) {
      connection = await tx.connection.create({
        data: {
          id: randomUUID(),
          organizationId: input.organizationId,
          projectId: input.projectId,
          createdBy: input.createdBy ?? null,
          name,
          type: "EXTERNAL_URL",
          mode: "AGENTLESS",
          environment: input.environment,
          authMethod: "NONE",
          capabilitiesJson: ["HTTP_AVAILABILITY", "SSL_CERTIFICATE"],
          configurationJson: {
            endpoint: url,
            method: "GET",
            timeoutMs: 10_000,
            monitoringRole: input.role
          },
          health: "UNKNOWN",
          healthReason: "Waiting for first check",
          installationStatus: "SCHEDULED",
          manifestVersion: "1.0",
          isActive: true,
          updatedAt: now
        }
      });
    } else {
      connection = await tx.connection.update({
        where: { id: connection.id },
        data: {
          type: "EXTERNAL_URL",
          mode: "AGENTLESS",
          environment: input.environment,
          authMethod: "NONE",
          capabilitiesJson: ["HTTP_AVAILABILITY", "SSL_CERTIFICATE"],
          configurationJson: {
            endpoint: url,
            method: "GET",
            timeoutMs: 10_000,
            monitoringRole: input.role
          },
          health: "UNKNOWN",
          healthReason: "Waiting for first check",
          installationStatus: "SCHEDULED",
          deactivatedAt: null,
          isActive: true,
          updatedAt: now
        }
      });
    }

    let serviceId = connection.linkedServiceId;
    if (serviceId) {
      const linked = await tx.service.findFirst({
        where: { id: serviceId, projectId: input.projectId },
        select: { id: true }
      });
      if (!linked) serviceId = null;
    }
    if (!serviceId) {
      const existingService = await tx.service.findFirst({
        where: { projectId: input.projectId, name },
        select: { id: true }
      });
      serviceId = existingService?.id ?? null;
    }
    if (!serviceId) {
      const service = await tx.service.create({
        data: {
          id: randomUUID(),
          projectId: input.projectId,
          name,
          type: "API",
          baseUrl: url,
          criticality: input.role === "PUBLIC" ? "HIGH" : "MEDIUM",
          isCritical: input.role === "PUBLIC",
          updatedAt: now
        }
      });
      serviceId = service.id;
    } else {
      await tx.service.update({
        where: { id: serviceId },
        data: { baseUrl: url, updatedAt: now }
      });
    }

    const httpCheckId = await ensureCheck(tx, {
      serviceId,
      connectionId: connection.id,
      role: input.role,
      type: "HTTP"
    });
    const sslCheckId = await ensureCheck(tx, {
      serviceId,
      connectionId: connection.id,
      role: input.role,
      type: "SSL"
    });

    await tx.connection.update({
      where: { id: connection.id },
      data: {
        linkedServiceId: serviceId,
        linkedCheckId: httpCheckId,
        updatedAt: now
      }
    });

    return {
      connectionId: connection.id,
      serviceId,
      httpCheckId,
      sslCheckId,
      url
    };
  });
};

export const deactivateUrlMonitoring = async (input: {
  organizationId: string;
  projectId: string;
  role: UrlMonitoringRole;
}): Promise<void> => {
  const connection = await prisma.connection.findFirst({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      name: displayName(input.role),
      isActive: true
    },
    select: { id: true, linkedServiceId: true }
  });
  if (!connection) return;
  await prisma.$transaction(async (tx) => {
    if (connection.linkedServiceId) {
      await tx.check.updateMany({
        where: { serviceId: connection.linkedServiceId },
        data: { isActive: false, updatedAt: new Date() }
      });
      await tx.service.updateMany({
        where: { id: connection.linkedServiceId, projectId: input.projectId },
        data: { status: "PAUSED", updatedAt: new Date() }
      });
    }
    await tx.connection.update({
      where: { id: connection.id },
      data: {
        isActive: false,
        deactivatedAt: new Date(),
        installationStatus: "DEACTIVATED",
        updatedAt: new Date()
      }
    });
  });
};
