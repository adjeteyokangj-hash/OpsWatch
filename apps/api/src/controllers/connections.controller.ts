import { randomUUID } from "crypto";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import {
  getConnectionManifest,
  isConnectionMode,
  negotiateCapabilities,
  validateConnectionConfiguration,
  validateConnectionInput
} from "../services/connection-manifest.service";
import {
  discoverApiConnection,
  testAgentlessConnection
} from "../services/agentless-connection.service";

const requireOrg = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const toConnectionDto = (row: any) => ({
  id: row.id,
  name: row.name,
  type: row.type,
  mode: row.mode,
  environment: row.environment,
  authMethod: row.authMethod,
  capabilities: row.capabilitiesJson ?? [],
  configuration: row.configurationJson ?? null,
  secretConfigured: Boolean(row.secretRef),
  health: row.health,
  healthReason: row.healthReason,
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
  res.json({ mode, ...getConnectionManifest(mode) });
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
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const type = typeof body.type === "string" ? body.type.trim() : "";
  if (!name || !type) {
    res.status(400).json({ error: "name and type are required" });
    return;
  }
  const validation = validateConnectionInput(body);
  if (validation) {
    res.status(400).json({ error: validation });
    return;
  }
  const projectId = body.projectId ? String(body.projectId) : null;
  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: orgId }, select: { id: true } });
    if (!project) {
      res.status(400).json({ error: "projectId is not in your organization" });
      return;
    }
  }
  const configuration = body.configuration === undefined ? null : asObject(body.configuration);
  if (body.configuration !== undefined && !configuration) {
    res.status(400).json({ error: "configuration must be an object" });
    return;
  }
  if (configuration && isConnectionMode(body.mode)) {
    const configurationValidation = validateConnectionConfiguration(body.mode, configuration);
    if (!configurationValidation.valid) {
      res.status(400).json({ error: configurationValidation.error });
      return;
    }
  }
  const capabilities = Array.isArray(body.capabilities) ? body.capabilities.filter((value: unknown): value is string => typeof value === "string") : [];
  const row = await prisma.connection.create({
    data: {
      id: randomUUID(),
      organizationId: orgId,
      projectId,
      name,
      type,
      mode: body.mode,
      environment: typeof body.environment === "string" ? body.environment : "production",
      authMethod: body.authMethod,
      capabilitiesJson: capabilities,
      ...(configuration ? { configurationJson: configuration as Prisma.InputJsonValue } : {}),
      secretRef: body.secretRef ? String(body.secretRef) : null,
      installationStatus: "CONFIGURED",
      manifestVersion: getConnectionManifest(body.mode).version,
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
  const mode = body.mode ?? existing.mode;
  const authMethod = body.authMethod ?? existing.authMethod;
  const validation = validateConnectionInput({
    mode,
    authMethod,
    capabilities: body.capabilities ?? existing.capabilitiesJson,
    configuration: body.configuration,
    secretRef: body.secretRef
  });
  if (validation) {
    res.status(400).json({ error: validation });
    return;
  }
  const configuration = body.configuration === undefined ? undefined : asObject(body.configuration);
  if (body.configuration !== undefined && !configuration) {
    res.status(400).json({ error: "configuration must be an object" });
    return;
  }
  if (configuration && isConnectionMode(mode)) {
    const configurationValidation = validateConnectionConfiguration(mode, configuration);
    if (!configurationValidation.valid) {
      res.status(400).json({ error: configurationValidation.error });
      return;
    }
  }
  const row = await prisma.connection.update({
    where: { id: existing.id },
    data: {
      ...(body.name !== undefined ? { name: String(body.name).trim() } : {}),
      ...(body.type !== undefined ? { type: String(body.type).trim() } : {}),
      ...(body.mode !== undefined ? { mode } : {}),
      ...(body.environment !== undefined ? { environment: String(body.environment) } : {}),
      ...(body.authMethod !== undefined ? { authMethod } : {}),
      ...(body.capabilities !== undefined ? {
        capabilitiesJson: Array.isArray(body.capabilities)
          ? body.capabilities.filter((value: unknown): value is string => typeof value === "string")
          : []
      } : {}),
      ...(configuration ? { configurationJson: configuration as Prisma.InputJsonValue } : {}),
      ...(body.secretRef !== undefined ? { secretRef: body.secretRef ? String(body.secretRef) : null } : {}),
      ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
      ...(body.isActive === false ? { deactivatedAt: new Date(), installationStatus: "DEACTIVATED" } : {}),
      ...(body.isActive === true ? { deactivatedAt: null } : {}),
      ...(body.mode !== undefined && isConnectionMode(mode) ? { manifestVersion: getConnectionManifest(mode).version } : {}),
      updatedAt: new Date()
    },
    include: { Project: { select: { id: true, name: true } } }
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
      configurationJson: true,
      secretRef: true
    }
  });
  if (!connection) {
    res.status(404).json({ error: "Active connection not found" });
    return;
  }
  const result = await testAgentlessConnection(connection);
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
      configurationJson: true,
      secretRef: true
    }
  });
  if (!connection) {
    res.status(404).json({ error: "Active connection not found" });
    return;
  }
  try {
    res.json(await discoverApiConnection(connection));
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "Discovery failed" });
  }
};

export const recordConnectionValidation = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const existing = await prisma.connection.findFirst({ where: { id: req.params.connectionId, organizationId: orgId } });
  if (!existing) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }
  if (typeof req.body?.succeeded !== "boolean") {
    res.status(400).json({ error: "succeeded must be a boolean" });
    return;
  }
  const succeeded = req.body.succeeded;
  const now = new Date();
  const row = await prisma.connection.update({
    where: { id: existing.id },
    data: succeeded
      ? { health: "HEALTHY", healthReason: null, lastSuccessAt: now, lastError: null, installationStatus: "ACTIVE", updatedAt: now }
      : { health: "DEGRADED", healthReason: "Connection validation failed", lastFailureAt: now, lastError: String(req.body?.error || "Validation failed"), installationStatus: "ERROR", updatedAt: now },
    include: { Project: { select: { id: true, name: true } } }
  });
  res.json(toConnectionDto(row));
};
