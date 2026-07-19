import { randomUUID } from "crypto";
import { prisma } from "../../../lib/prisma";
import { testAgentlessConnection } from "../../agentless-connection.service";
import type { RemediationExecutor } from "../types";
import { completed, failed, missingContext } from "./_common";
import { redactUnknown } from "../../../lib/redact-secrets";

const loadConnection = async (organizationId: string, connectionId: string) =>
  prisma.connection.findFirst({
    where: { id: connectionId, organizationId },
    select: {
      id: true,
      organizationId: true,
      projectId: true,
      name: true,
      mode: true,
      environment: true,
      authMethod: true,
      configurationJson: true,
      credentialFamilyId: true,
      secretRef: true,
      managedSecretCiphertext: true,
      managedSecretIv: true,
      managedSecretAuthTag: true,
      linkedServiceId: true,
      linkedCheckId: true,
      isActive: true,
      health: true,
      lastValidatedAt: true,
      lastSuccessAt: true,
      lastFailureAt: true,
      lastError: true,
      deactivatedAt: true
    }
  });

export const executeTestConnection: RemediationExecutor = async ({ context, executedBy }) => {
  const connectionId =
    (typeof context.extra?.connectionId === "string" && context.extra.connectionId) ||
    context.integrationId;
  if (!connectionId) {
    return missingContext("connectionId is required for TEST_CONNECTION.", ["connectionId"]);
  }

  const connection = await loadConnection(context.organizationId, connectionId);
  if (!connection) {
    return failed("Connection not found for organization.");
  }
  if (!connection.isActive) {
    return failed("Connection is inactive. Re-enable it before testing.");
  }

  const result = await testAgentlessConnection(connection, { startMonitoring: false });
  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      userId: executedBy ?? null,
      action: "REMEDIATION_TEST_CONNECTION",
      entityType: "CONNECTION",
      entityId: connection.id,
      metadataJson: redactUnknown({
        succeeded: result.succeeded,
        health: result.succeeded ? "HEALTHY" : "DEGRADED",
        organizationId: context.organizationId,
        projectId: connection.projectId
      }) as object
    }
  });

  return result.succeeded
    ? completed("Connection probe succeeded.", {
        connectionId: connection.id,
        health: "HEALTHY",
        latencyMs: result.responseTimeMs ?? null,
        statusCode: result.statusCode ?? null
      })
    : failed(result.error ?? "Connection probe failed.", {
        connectionId: connection.id,
        health: "DEGRADED",
        errorCategory: result.errorCategory ?? null
      });
};

export const executeRefreshConnectionStatus: RemediationExecutor = async ({
  context,
  executedBy
}) => {
  const connectionId =
    (typeof context.extra?.connectionId === "string" && context.extra.connectionId) ||
    context.integrationId;
  if (!connectionId) {
    return missingContext("connectionId is required for REFRESH_CONNECTION_STATUS.", [
      "connectionId"
    ]);
  }

  const connection = await loadConnection(context.organizationId, connectionId);
  if (!connection) {
    return failed("Connection not found for organization.");
  }

  // Refresh = re-probe when active; otherwise return persisted snapshot only.
  if (connection.isActive) {
    const result = await testAgentlessConnection(connection, { startMonitoring: false });
    return completed("Connection status refreshed via probe.", {
      connectionId: connection.id,
      isActive: connection.isActive,
      health: result.succeeded ? "HEALTHY" : "DEGRADED",
      succeeded: result.succeeded,
      lastValidatedAt: new Date().toISOString()
    });
  }

  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      userId: executedBy ?? null,
      action: "REMEDIATION_REFRESH_CONNECTION_STATUS",
      entityType: "CONNECTION",
      entityId: connection.id,
      metadataJson: {
        isActive: false,
        health: connection.health,
        organizationId: context.organizationId
      }
    }
  });

  return completed("Connection status snapshot refreshed (inactive — no probe).", {
    connectionId: connection.id,
    isActive: false,
    health: connection.health,
    lastValidatedAt: connection.lastValidatedAt?.toISOString() ?? null,
    lastSuccessAt: connection.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: connection.lastFailureAt?.toISOString() ?? null,
    lastError: connection.lastError
  });
};

export const executeReenableConnection: RemediationExecutor = async ({ context, executedBy }) => {
  const connectionId =
    (typeof context.extra?.connectionId === "string" && context.extra.connectionId) ||
    context.integrationId;
  if (!connectionId) {
    return missingContext("connectionId is required for REENABLE_CONNECTION.", ["connectionId"]);
  }

  const connection = await loadConnection(context.organizationId, connectionId);
  if (!connection) {
    return failed("Connection not found for organization.");
  }

  const updated = await prisma.connection.update({
    where: { id: connection.id },
    data: {
      isActive: true,
      deactivatedAt: null,
      updatedAt: new Date()
    },
    select: {
      id: true,
      organizationId: true,
      projectId: true,
      name: true,
      mode: true,
      environment: true,
      authMethod: true,
      configurationJson: true,
      credentialFamilyId: true,
      secretRef: true,
      managedSecretCiphertext: true,
      managedSecretIv: true,
      managedSecretAuthTag: true,
      linkedServiceId: true,
      linkedCheckId: true,
      isActive: true
    }
  });

  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      userId: executedBy ?? null,
      action: "REMEDIATION_REENABLE_CONNECTION",
      entityType: "CONNECTION",
      entityId: updated.id,
      metadataJson: { organizationId: context.organizationId, previousActive: connection.isActive }
    }
  });

  const probe = await testAgentlessConnection(updated, { startMonitoring: false });
  if (!probe.succeeded) {
    return failed("Connection re-enabled but verification probe failed.", {
      connectionId: updated.id,
      health: "DEGRADED",
      error: probe.error ?? null
    });
  }

  return completed("Connection re-enabled and probe verified.", {
    connectionId: updated.id,
    health: "HEALTHY",
    latencyMs: probe.responseTimeMs ?? null
  });
};

export const executeRequestFreshHeartbeat: RemediationExecutor = async ({
  context,
  executedBy
}) => {
  if (!context.projectId) {
    return missingContext("projectId is required for REQUEST_FRESH_HEARTBEAT.", ["projectId"]);
  }

  const project = await prisma.project.findFirst({
    where: { id: context.projectId, organizationId: context.organizationId },
    select: { id: true, name: true }
  });
  if (!project) {
    return failed("Project not found for organization.");
  }

  const requestId = randomUUID();
  const requestedAt = new Date();
  await prisma.auditLog.create({
    data: {
      id: requestId,
      userId: executedBy ?? null,
      action: "REMEDIATION_REQUEST_FRESH_HEARTBEAT",
      entityType: "PROJECT",
      entityId: project.id,
      metadataJson: {
        organizationId: context.organizationId,
        projectId: project.id,
        serviceId: context.serviceId ?? null,
        alertId: context.alertId ?? null,
        incidentId: context.incidentId ?? null,
        requestedAt: requestedAt.toISOString()
      }
    }
  });

  // Verification looks for heartbeats after the request timestamp (handled by verify layer).
  const recent = await prisma.heartbeat.findFirst({
    where: {
      projectId: project.id,
      receivedAt: { gte: new Date(requestedAt.getTime() - 60_000) }
    },
    orderBy: { receivedAt: "desc" },
    select: { id: true, receivedAt: true, status: true }
  });

  return completed("Fresh heartbeat requested; awaiting subsequent ingest evidence.", {
    requestId,
    projectId: project.id,
    serviceId: context.serviceId ?? null,
    requestedAt: requestedAt.toISOString(),
    latestHeartbeatId: recent?.id ?? null,
    latestHeartbeatAt: recent?.receivedAt?.toISOString() ?? null,
    verificationPending: true
  });
};
