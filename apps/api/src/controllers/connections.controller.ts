import { randomUUID } from "crypto";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import {
  getConnectionManifest,
  isConnectionMode,
  negotiateCapabilities,
  validateConnectionInput
} from "../services/connection-manifest.service";

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
      updatedAt: new Date()
    },
    include: { Project: { select: { id: true, name: true } } }
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
  const row = await prisma.connection.update({
    where: { id: existing.id },
    data: {
      ...(body.name !== undefined ? { name: String(body.name).trim() } : {}),
      ...(body.type !== undefined ? { type: String(body.type).trim() } : {}),
      ...(body.mode !== undefined ? { mode } : {}),
      ...(body.environment !== undefined ? { environment: String(body.environment) } : {}),
      ...(body.authMethod !== undefined ? { authMethod } : {}),
      ...(body.capabilities !== undefined ? { capabilitiesJson: body.capabilities } : {}),
      ...(configuration ? { configurationJson: configuration as Prisma.InputJsonValue } : {}),
      ...(body.secretRef !== undefined ? { secretRef: body.secretRef ? String(body.secretRef) : null } : {}),
      ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
      updatedAt: new Date()
    },
    include: { Project: { select: { id: true, name: true } } }
  });
  res.json(toConnectionDto(row));
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
