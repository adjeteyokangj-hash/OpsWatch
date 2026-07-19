import { randomUUID } from "crypto";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { encryptSecret } from "../lib/secret-crypto";
import type { AuthRequest } from "../middleware/auth";
import {
  getConnectionManifest,
  isConnectionMode,
  negotiateCapabilities,
  parseGuidedConnectionInput,
  validateConnectionConfiguration,
  validateConnectionInput
} from "../services/connection-manifest.service";
import {
  discoverApiConnection,
  testAgentlessConnection,
  testUnsavedConnection
} from "../services/agentless-connection.service";
import { isOtelIngestionEnabled } from "../services/otel-bridge.service";

const requireOrg = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

const toConnectionDto = (row: any) => ({
  id: row.id,
  name: row.name,
  type: row.type,
  mode: row.mode,
  environment: row.environment,
  authMethod: row.authMethod,
  capabilities: row.capabilitiesJson ?? [],
  configuration: row.configurationJson ?? null,
  secretConfigured: Boolean(row.secretRef || (row.managedSecretCiphertext && row.managedSecretIv && row.managedSecretAuthTag)),
  health: row.health,
  healthReason: row.healthReason,
  lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null,
  validationStatusCode: row.validationStatusCode,
  validationLatencyMs: row.validationLatencyMs,
  validationErrorCategory: row.validationErrorCategory,
  lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
  lastFailureAt: row.lastFailureAt?.toISOString() ?? null,
  lastError: row.lastError,
  requestRatePerMinute: row.requestRatePerMinute,
  errorRatePercent: row.errorRatePercent,
  permissions: row.permissionsJson ?? null,
  installationStatus: row.installationStatus,
  collectorVersion: row.collectorVersion,
  manifestVersion: row.manifestVersion,
  deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
  isActive: row.isActive,
  linkedServiceId: row.linkedServiceId,
  linkedCheckId: row.linkedCheckId,
  project: row.Project ? { id: row.Project.id, name: row.Project.name } : null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString()
});

export const listConnections = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  const rows = await prisma.connection.findMany({
    where: { organizationId: orgId, ...(projectId ? { projectId } : {}) },
    include: { Project: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" }
  });
  res.json(rows.map(toConnectionDto));
};

export const getConnectionManifestHandler = async (req: AuthRequest, res: Response) => {
  const mode = req.params.mode;
  if (!isConnectionMode(mode)) {
    res.status(400).json({ error: "Unknown connection mode" });
    return;
  }
  res.json({
    mode,
    ...getConnectionManifest(mode),
    ...(mode === "OTEL_COLLECTOR" ? { otelIngestionEnabled: isOtelIngestionEnabled() } : {})
  });
};

export const negotiateConnectionCapabilities = async (req: AuthRequest, res: Response) => {
  const mode = req.body?.mode;
  if (!isConnectionMode(mode)) {
    res.status(400).json({ error: "Unknown connection mode" });
    return;
  }
  res.json({ mode, ...negotiateCapabilities(mode, req.body?.capabilities) });
};

export const createConnection = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const body = req.body ?? {};
  let parsed;
  try {
    parsed = parseGuidedConnectionInput(body);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid connection configuration" });
    return;
  }
  const { name, type } = parsed;
  if (!name || !type) {
    res.status(400).json({ error: "name and type are required" });
    return;
  }
  const validation = validateConnectionInput({
    mode: parsed.mode,
    authMethod: parsed.authMethod,
    capabilities: parsed.capabilities,
    configuration: parsed.configuration,
    secretRef: parsed.secretRef
  });
  if (validation) {
    res.status(400).json({ error: validation });
    return;
  }
  const projectId = parsed.projectId;
  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: orgId }, select: { id: true } });
    if (!project) {
      res.status(400).json({ error: "projectId is not in your organization" });
      return;
    }
  }
  const configuration = parsed.configuration;
  if (isConnectionMode(parsed.mode)) {
    const configurationValidation = validateConnectionConfiguration(parsed.mode, configuration);
    if (!configurationValidation.valid) {
      res.status(400).json({ error: configurationValidation.error });
      return;
    }
  }
  const encrypted = parsed.authSecret ? encryptSecret(parsed.authSecret) : null;
  const row = await prisma.connection.create({
    data: {
      id: randomUUID(),
      organizationId: orgId,
      createdBy: req.user?.id ?? req.user?.sub ?? null,
      projectId,
      name,
      type,
      mode: parsed.mode,
      environment: parsed.environment,
      authMethod: parsed.authMethod,
      capabilitiesJson: parsed.capabilities,
      configurationJson: configuration as Prisma.InputJsonValue,
      secretRef: parsed.secretRef ?? null,
      ...(encrypted ? {
        managedSecretCiphertext: encrypted.ciphertext,
        managedSecretIv: encrypted.iv,
        managedSecretAuthTag: encrypted.authTag
      } : {}),
      health: "UNKNOWN",
      installationStatus: "DRAFT",
      manifestVersion: getConnectionManifest(parsed.mode).version,
      updatedAt: new Date()
    },
    include: { Project: { select: { id: true, name: true } } }
  });
  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      userId: req.user?.id,
      action: "CONNECTION_CREATED",
      entityType: "CONNECTION",
      entityId: row.id,
      metadataJson: { organizationId: orgId, mode: row.mode, manifestVersion: row.manifestVersion }
    }
  });
  res.status(201).json(toConnectionDto(row));
};

export const patchConnection = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const existing = await prisma.connection.findFirst({ where: { id: req.params.connectionId, organizationId: orgId } });
  if (!existing) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }
  const body = req.body ?? {};
  let parsed;
  try {
    parsed = parseGuidedConnectionInput({
      name: existing.name,
      type: existing.type,
      mode: existing.mode,
      environment: existing.environment,
      authMethod: existing.authMethod,
      projectId: existing.projectId,
      capabilities: existing.capabilitiesJson,
      configuration: existing.configurationJson,
      ...body
    }, { partial: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid connection configuration" });
    return;
  }
  const validation = validateConnectionInput({
    mode: parsed.mode,
    authMethod: parsed.authMethod,
    capabilities: parsed.capabilities,
    configuration: parsed.configuration,
    secretRef: parsed.secretRef ?? existing.secretRef
  });
  if (validation) {
    res.status(400).json({ error: validation });
    return;
  }
  const configurationValidation = validateConnectionConfiguration(parsed.mode, parsed.configuration);
  if (!configurationValidation.valid) {
    res.status(400).json({ error: configurationValidation.error });
    return;
  }
  if (parsed.projectId) {
    const project = await prisma.project.findFirst({ where: { id: parsed.projectId, organizationId: orgId }, select: { id: true } });
    if (!project) {
      res.status(400).json({ error: "projectId is not in your organization" });
      return;
    }
  }
  const reconfiguredKeys = [
    "configuration", "baseUrl", "healthPath", "discoveryPath", "timeoutMs", "requestMethod",
    "authType", "authMethod", "authSecret", "authHeaderName", "authPrefix", "mode", "connectorType", "type"
  ];
  const reconfigured = reconfiguredKeys.some((key) => Object.prototype.hasOwnProperty.call(body, key));
  const encrypted = parsed.authSecret ? encryptSecret(parsed.authSecret) : null;
  if (body.name !== undefined && !parsed.name) {
    res.status(400).json({ error: "name must not be empty" });
    return;
  }
  const row = await prisma.$transaction(async (tx) => {
    if (body.isActive === false && existing.linkedCheckId) {
      await tx.check.updateMany({
        where: { id: existing.linkedCheckId },
        data: { isActive: false, updatedAt: new Date() }
      });
    }
    if (body.isActive === true && existing.linkedCheckId) {
      await tx.check.updateMany({
        where: { id: existing.linkedCheckId },
        data: { isActive: true, updatedAt: new Date() }
      });
    }
    return tx.connection.update({
      where: { id: existing.id },
      data: {
        ...(body.name !== undefined ? { name: parsed.name } : {}),
        ...((body.type !== undefined || body.connectorType !== undefined) ? { type: parsed.type } : {}),
        ...(body.mode !== undefined ? { mode: parsed.mode } : {}),
        ...((body.projectId !== undefined || body.applicationId !== undefined) ? { projectId: parsed.projectId } : {}),
        ...(body.environment !== undefined ? { environment: parsed.environment } : {}),
        ...((body.authMethod !== undefined || body.authType !== undefined) ? { authMethod: parsed.authMethod } : {}),
        ...(body.capabilities !== undefined ? { capabilitiesJson: parsed.capabilities } : {}),
        ...(reconfigured ? { configurationJson: parsed.configuration as Prisma.InputJsonValue } : {}),
        ...(body.secretRef !== undefined ? { secretRef: parsed.secretRef ?? null } : {}),
        ...(encrypted ? {
          managedSecretCiphertext: encrypted.ciphertext,
          managedSecretIv: encrypted.iv,
          managedSecretAuthTag: encrypted.authTag
        } : {}),
        ...(reconfigured ? {
          health: "UNKNOWN",
          healthReason: null,
          lastValidatedAt: null,
          validationStatusCode: null,
          validationLatencyMs: null,
          validationErrorCategory: null,
          lastSuccessAt: null,
          lastFailureAt: null,
          lastError: null,
          installationStatus: "DRAFT"
        } : {}),
        ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
        ...(body.isActive === false ? { deactivatedAt: new Date(), installationStatus: "DEACTIVATED" } : {}),
        ...(body.isActive === true ? { deactivatedAt: null } : {}),
        ...(body.mode !== undefined ? { manifestVersion: getConnectionManifest(parsed.mode).version } : {}),
        updatedAt: new Date()
      },
      include: { Project: { select: { id: true, name: true } } }
    });
  });
  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      userId: req.user?.id,
      action: body.isActive === false ? "CONNECTION_DEACTIVATED" : "CONNECTION_UPDATED",
      entityType: "CONNECTION",
      entityId: row.id,
      metadataJson: { organizationId: orgId, mode: row.mode, isActive: row.isActive }
    }
  });
  res.json(toConnectionDto(row));
};

export const testConnection = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const connection = await prisma.connection.findFirst({
    where: { id: req.params.connectionId, organizationId: orgId, isActive: true },
    select: {
      id: true,
      organizationId: true,
      projectId: true,
      name: true,
      mode: true,
      authMethod: true,
      configurationJson: true,
      secretRef: true,
      managedSecretCiphertext: true,
      managedSecretIv: true,
      managedSecretAuthTag: true,
      linkedServiceId: true,
      linkedCheckId: true
    }
  });
  if (!connection) {
    res.status(404).json({ error: "Active connection not found" });
    return;
  }
  if (req.body?.startMonitoring === true && !connection.projectId) {
    res.status(400).json({ error: "A project is required to start monitoring" });
    return;
  }
  const result = await testAgentlessConnection(connection, { startMonitoring: req.body?.startMonitoring === true });
  res.status(result.succeeded ? 200 : 422).json(result);
};

export const testUnsavedConnectionHandler = async (req: AuthRequest, res: Response) => {
  if (!requireOrg(req, res)) return;
  let parsed;
  try {
    parsed = parseGuidedConnectionInput(req.body ?? {});
    const validation = validateConnectionInput({
      mode: parsed.mode,
      authMethod: parsed.authMethod,
      capabilities: parsed.capabilities,
      configuration: parsed.configuration,
      secretRef: parsed.secretRef
    });
    if (validation) throw new Error(validation);
    const configurationValidation = validateConnectionConfiguration(parsed.mode, parsed.configuration);
    if (!configurationValidation.valid) throw new Error(configurationValidation.error);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid connection configuration" });
    return;
  }
  const result = await testUnsavedConnection({
    mode: parsed.mode,
    authMethod: parsed.authMethod,
    configurationJson: parsed.configuration,
    authSecret: parsed.authSecret
  });
  res.status(result.succeeded ? 200 : 422).json(result);
};

export const discoverConnection = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const connection = await prisma.connection.findFirst({
    where: { id: req.params.connectionId, organizationId: orgId, isActive: true },
    select: {
      id: true,
      organizationId: true,
      projectId: true,
      name: true,
      mode: true,
      authMethod: true,
      configurationJson: true,
      secretRef: true,
      managedSecretCiphertext: true,
      managedSecretIv: true,
      managedSecretAuthTag: true
    }
  });
  if (!connection) {
    res.status(404).json({ error: "Active connection not found" });
    return;
  }
  try {
    res.json(await discoverApiConnection(connection));
  } catch (error) {
    res.status(422).json({
      error: error instanceof Error ? error.message : "Discovery failed",
      errorCategory: "DISCOVERY_FAILED"
    });
  }
};

export const recordConnectionValidation = async (req: AuthRequest, res: Response) => {
  if (!requireOrg(req, res)) return;
  res.status(410).json({ error: "Client-reported validation is deprecated; use the server-side test endpoint" });
};

const findManagedConnection = (orgId: string, id?: string) =>
  id ? prisma.connection.findFirst({ where: { id, organizationId: orgId } }) : Promise.resolve(null);

export const disableConnection = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const existing = await findManagedConnection(orgId, req.params.connectionId);
  if (!existing) return void res.status(404).json({ error: "Connection not found" });
  await prisma.$transaction(async (tx) => {
    if (existing.linkedCheckId) await tx.check.updateMany({ where: { id: existing.linkedCheckId }, data: { isActive: false, updatedAt: new Date() } });
    await tx.connection.update({ where: { id: existing.id }, data: { isActive: false, deactivatedAt: new Date(), installationStatus: "DEACTIVATED", updatedAt: new Date() } });
  });
  res.status(204).send();
};

export const reactivateConnection = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const existing = await findManagedConnection(orgId, req.params.connectionId);
  if (!existing) return void res.status(404).json({ error: "Connection not found" });
  await prisma.$transaction(async (tx) => {
    if (existing.linkedCheckId) {
      await tx.check.updateMany({
        where: { id: existing.linkedCheckId },
        data: { isActive: true, updatedAt: new Date() }
      });
    }
    await tx.connection.update({
      where: { id: existing.id },
      data: { isActive: true, deactivatedAt: null, health: "UNKNOWN", installationStatus: "DRAFT", updatedAt: new Date() }
    });
  });
  res.status(204).send();
};

export const deleteConnection = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const existing = await findManagedConnection(orgId, req.params.connectionId);
  if (!existing) return void res.status(404).json({ error: "Connection not found" });
  await prisma.$transaction(async (tx) => {
    if (existing.linkedCheckId) await tx.check.updateMany({ where: { id: existing.linkedCheckId }, data: { isActive: false, updatedAt: new Date() } });
    await tx.connection.delete({ where: { id: existing.id } });
  });
  res.status(204).send();
};

export const rotateConnectionCredential = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const existing = await findManagedConnection(orgId, req.params.connectionId);
  if (!existing) return void res.status(404).json({ error: "Connection not found" });
  const authSecret = typeof req.body?.authSecret === "string" ? req.body.authSecret.trim() : "";
  if (!authSecret) return void res.status(400).json({ error: "authSecret is required" });
  const result = await testUnsavedConnection({
    mode: existing.mode,
    authMethod: existing.authMethod,
    configurationJson: existing.configurationJson,
    authSecret
  });
  if (!result.succeeded) {
    res.status(422).json(result);
    return;
  }
  const encrypted = encryptSecret(authSecret);
  await prisma.$transaction([
    prisma.connection.update({
      where: { id: existing.id },
      data: {
        managedSecretCiphertext: encrypted.ciphertext,
        managedSecretIv: encrypted.iv,
        managedSecretAuthTag: encrypted.authTag,
        secretRef: null,
        health: "HEALTHY",
        installationStatus: "CONNECTED",
        lastValidatedAt: new Date(),
        validationStatusCode: result.statusCode ?? null,
        validationLatencyMs: result.responseTimeMs ?? null,
        validationErrorCategory: null,
        updatedAt: new Date()
      }
    }),
    prisma.auditLog.create({
      data: {
        id: randomUUID(), userId: req.user?.id, action: "CONNECTION_CREDENTIAL_ROTATED",
        entityType: "CONNECTION", entityId: existing.id, metadataJson: { organizationId: orgId, validated: true }
      }
    })
  ]);
  res.json({ succeeded: true, secretConfigured: true, statusCode: result.statusCode, responseTimeMs: result.responseTimeMs });
};
