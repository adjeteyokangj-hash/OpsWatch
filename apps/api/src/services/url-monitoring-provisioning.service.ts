import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { parseSafeExternalHttpUrl } from "@opswatch/shared";
import { prisma } from "../lib/prisma";
import { assertSafeConnectionTarget } from "./agentless-connection.service";
import {
  getMonitorEntitlementCapacityInTransaction,
  getOrganizationEntitlements
} from "./entitlements/entitlement.service";

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

export type ReconcileProjectUrlMonitoringInput = {
  organizationId: string;
  projectId: string;
  projectName: string;
  environment: string;
  publicUrl?: string | null;
  adminUrl?: string | null;
  createdBy?: string | null;
};

export class UrlMonitorEntitlementError extends Error {
  readonly monitorsRequired: number;
  readonly monitorsAvailable: number;
  readonly urlMonitoring: string[];

  constructor(input: { required: number; available: number; roles: UrlMonitoringRole[] }) {
    const labels = input.roles.map((role) => role === "PUBLIC" ? "public URL" : "admin URL");
    super(
      `Cannot provision ${labels.join(" and ")} monitoring: ` +
      `${input.required} monitors required, ${input.available} available`
    );
    this.name = "UrlMonitorEntitlementError";
    this.monitorsRequired = input.required;
    this.monitorsAvailable = input.available;
    this.urlMonitoring = labels;
  }
}

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

const findRoleState = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    projectId: string;
    role: UrlMonitoringRole;
  }
) => {
  const name = displayName(input.role);
  const connection = await tx.connection.findFirst({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      name
    }
  });
  let serviceId = connection?.linkedServiceId ?? null;
  if (serviceId) {
    const linked = await tx.service.findFirst({
      where: { id: serviceId, projectId: input.projectId },
      select: { id: true }
    });
    if (!linked) serviceId = null;
  }
  if (!serviceId) {
    serviceId = (await tx.service.findFirst({
      where: { projectId: input.projectId, name },
      select: { id: true }
    }))?.id ?? null;
  }
  const checks = serviceId
    ? await tx.check.findMany({
        where: {
          serviceId,
          name: { in: [`${name} availability`, `${name} certificate`] },
          type: { in: ["HTTP", "SSL"] }
        },
        select: { id: true, type: true, name: true, isActive: true }
      })
    : [];
  const activeTypes = new Set(checks.filter((check) => check.isActive).map((check) => check.type));
  return {
    connection,
    serviceId,
    additionalMonitors: Number(!activeTypes.has("HTTP")) + Number(!activeTypes.has("SSL"))
  };
};

const deactivateRoleInTransaction = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    projectId: string;
    role: UrlMonitoringRole;
  }
): Promise<void> => {
  const state = await findRoleState(tx, input);
  if (!state.connection) return;
  if (state.serviceId) {
    await tx.check.updateMany({
      where: { serviceId: state.serviceId, isActive: true },
      data: { isActive: false, updatedAt: new Date() }
    });
    await tx.service.updateMany({
      where: { id: state.serviceId, projectId: input.projectId },
      data: { status: "PAUSED", updatedAt: new Date() }
    });
  }
  await tx.connection.update({
    where: { id: state.connection.id },
    data: {
      isActive: false,
      deactivatedAt: new Date(),
      installationStatus: "DEACTIVATED",
      updatedAt: new Date()
    }
  });
};

const provisionRoleInTransaction = async (
  tx: Prisma.TransactionClient,
  input: ProvisionUrlMonitoringInput & { url: string }
): Promise<ProvisionedUrlMonitoring> => {
  const name = displayName(input.role);
  const now = new Date();
  const state = await findRoleState(tx, input);
  let connection = state.connection;

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
          endpoint: input.url,
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
          endpoint: input.url,
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

  let serviceId = state.serviceId;
  if (!serviceId) {
    const service = await tx.service.create({
      data: {
        id: randomUUID(),
        projectId: input.projectId,
        name,
        type: "API",
        baseUrl: input.url,
        criticality: input.role === "PUBLIC" ? "HIGH" : "MEDIUM",
        isCritical: input.role === "PUBLIC",
        updatedAt: now
      }
    });
    serviceId = service.id;
  } else {
    await tx.service.update({
      where: { id: serviceId },
      data: { baseUrl: input.url, updatedAt: now }
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
    data: { linkedServiceId: serviceId, linkedCheckId: httpCheckId, updatedAt: now }
  });
  return { connectionId: connection.id, serviceId, httpCheckId, sslCheckId, url: input.url };
};

export const provisionUrlMonitoring = async (
  input: ProvisionUrlMonitoringInput
): Promise<ProvisionedUrlMonitoring> => {
  const url = await normalizeMonitoringUrl(input.url);
  const result = await reconcileProjectUrlMonitoring({
    organizationId: input.organizationId,
    projectId: input.projectId,
    projectName: input.projectName,
    environment: input.environment,
    ...(input.role === "PUBLIC" ? { publicUrl: url } : { adminUrl: url }),
    createdBy: input.createdBy
  });
  return (input.role === "PUBLIC" ? result.public : result.admin)!;
};

export const reconcileProjectUrlMonitoring = async (
  input: ReconcileProjectUrlMonitoringInput
): Promise<{ public?: ProvisionedUrlMonitoring; admin?: ProvisionedUrlMonitoring }> => {
  // Ensures a default subscription exists before the authoritative transaction.
  await getOrganizationEntitlements(input.organizationId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT id FROM "Organization" WHERE id = ${input.organizationId} FOR UPDATE`
        );
        if (locked.length !== 1) throw new Error("Organization not found");
        const project = await tx.project.findFirst({
          where: { id: input.projectId, organizationId: input.organizationId },
          select: { id: true }
        });
        if (!project) throw new Error("Application is not in your organization");

        const requested = [
          ...(input.publicUrl !== undefined ? [{ role: "PUBLIC" as const, url: input.publicUrl }] : []),
          ...(input.adminUrl !== undefined ? [{ role: "ADMIN" as const, url: input.adminUrl }] : [])
        ];
        const additions: Array<{ role: UrlMonitoringRole; count: number }> = [];
        for (const target of requested) {
          if (target.url) {
            const state = await findRoleState(tx, {
              organizationId: input.organizationId,
              projectId: input.projectId,
              role: target.role
            });
            additions.push({ role: target.role, count: state.additionalMonitors });
          }
        }
        const monitorsRequired = additions.reduce((sum, row) => sum + row.count, 0);
        const capacity = await getMonitorEntitlementCapacityInTransaction(tx, input.organizationId);
        const available = capacity.available ?? Number.MAX_SAFE_INTEGER;
        if (
          monitorsRequired > 0 &&
          (!capacity.enabled || !capacity.allowMutations || monitorsRequired > available)
        ) {
          throw new UrlMonitorEntitlementError({
            required: monitorsRequired,
            available: capacity.enabled && capacity.allowMutations ? available : 0,
            roles: additions.filter((row) => row.count > 0).map((row) => row.role)
          });
        }

        const result: { public?: ProvisionedUrlMonitoring; admin?: ProvisionedUrlMonitoring } = {};
        for (const target of requested) {
          if (target.url) {
            const provisioned = await provisionRoleInTransaction(tx, {
              organizationId: input.organizationId,
              projectId: input.projectId,
              projectName: input.projectName,
              environment: input.environment,
              role: target.role,
              url: target.url,
              createdBy: input.createdBy
            });
            if (target.role === "PUBLIC") result.public = provisioned;
            else result.admin = provisioned;
          } else {
            await deactivateRoleInTransaction(tx, {
              organizationId: input.organizationId,
              projectId: input.projectId,
              role: target.role
            });
          }
        }
        await tx.project.update({
          where: { id: input.projectId },
          data: {
            ...(input.publicUrl !== undefined ? { frontendUrl: input.publicUrl } : {}),
            ...(input.adminUrl !== undefined ? { adminUrl: input.adminUrl } : {}),
            updatedAt: new Date()
          }
        });
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (
        attempt < 2 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("URL monitoring transaction retry limit exceeded");
};

export const deactivateUrlMonitoring = async (input: {
  organizationId: string;
  projectId: string;
  role: UrlMonitoringRole;
}): Promise<void> => {
  await getOrganizationEntitlements(input.organizationId);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "Organization" WHERE id = ${input.organizationId} FOR UPDATE`
    );
    await deactivateRoleInTransaction(tx, input);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};
