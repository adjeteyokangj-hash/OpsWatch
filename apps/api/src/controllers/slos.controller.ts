import { randomUUID } from "crypto";
import { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { handleEntitlementFailure } from "../controllers/subscription.controller";
import { assertWithinLimit } from "../services/entitlements/entitlement.service";
import { ENTITLEMENT } from "../services/entitlements/entitlement-keys";

const SLI_TYPES = ["AVAILABILITY", "ERROR_RATE", "LATENCY"] as const;
const TARGET_TYPES = ["APP", "MODULE", "WORKFLOW", "COMPONENT", "SERVICE"] as const;
const WINDOW_TYPES = ["ROLLING", "CALENDAR"] as const;
const ROLLING_DAYS = [1, 7, 14, 28, 30, 90] as const;
const CALENDAR_DAYS = [7, 30, 90, 365] as const;
const fail = (res: Response, status: number, code: string, message: string, details?: unknown) =>
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });

const context = async (req: AuthRequest, res: Response) => {
  const organizationId = req.user?.organizationId;
  if (!organizationId) { fail(res, 403, "ORGANIZATION_REQUIRED", "Organization required"); return null; }
  const project = await prisma.project.findFirst({ where: { id: req.params.projectId, organizationId }, select: { id: true } });
  if (!project) { fail(res, 404, "PROJECT_NOT_FOUND", "Project not found"); return null; }
  return { organizationId, projectId: project.id };
};

const validate = async (res: Response, body: any, projectId: string) => {
  const name = String(body.name ?? "").trim();
  const sliType = String(body.sliType ?? "").toUpperCase();
  const targetType = String(body.targetType ?? "SERVICE").toUpperCase();
  const windowType = String(body.windowType ?? "ROLLING").toUpperCase();
  const targetPct = Number(body.targetPct);
  const windowDays = Number(body.windowDays);
  const serviceId = body.serviceId ? String(body.serviceId) : null;
  const targetId = body.targetId ? String(body.targetId) : serviceId;
  const latencyThresholdMs = body.latencyThresholdMs == null ? null : Number(body.latencyThresholdMs);
  if (!name) { fail(res, 400, "VALIDATION_ERROR", "name is required"); return null; }
  if (!SLI_TYPES.includes(sliType as any)) { fail(res, 400, "UNSUPPORTED_SLI_TYPE", "Unsupported SLI type", { supported: SLI_TYPES }); return null; }
  if (!(targetPct > 0 && targetPct <= 100)) { fail(res, 400, "INVALID_SLO_TARGET", "targetPct must be greater than 0 and no higher than 100"); return null; }
  if (!TARGET_TYPES.includes(targetType as any)) { fail(res, 400, "UNSUPPORTED_TARGET_TYPE", "Unsupported monitored-area layer", { supported: TARGET_TYPES }); return null; }
  if (!WINDOW_TYPES.includes(windowType as any)) { fail(res, 400, "UNSUPPORTED_WINDOW_TYPE", "Unsupported evaluation window type", { supported: WINDOW_TYPES }); return null; }
  const supportedDays = windowType === "ROLLING" ? ROLLING_DAYS : CALENDAR_DAYS;
  if (!supportedDays.includes(windowDays as any)) { fail(res, 400, "INVALID_WINDOW_SIZE", `Unsupported ${windowType.toLowerCase()} window size`, { supportedDays }); return null; }
  if (sliType === "LATENCY" && !(latencyThresholdMs && latencyThresholdMs > 0)) { fail(res, 400, "INVALID_LATENCY_THRESHOLD", "A positive latencyThresholdMs is required for latency SLOs"); return null; }
  if ((targetType === "SERVICE" || targetType === "COMPONENT") && !serviceId) { fail(res, 400, "TARGET_REQUIRED", "serviceId is required for component and service SLOs"); return null; }
  if (serviceId && !await prisma.service.findFirst({ where: { id: serviceId, projectId }, select: { id: true } })) { fail(res, 400, "INVALID_SERVICE", "serviceId is not part of this project"); return null; }
  return { name, sliType, targetType, targetId, serviceId, targetPct, windowType, windowDays, latencyThresholdMs, enabled: body.enabled !== undefined ? Boolean(body.enabled) : true };
};

const audit = (userId: string | undefined, action: string, id: string, metadataJson: any) =>
  prisma.auditLog.create({ data: { id: randomUUID(), userId, action, entityType: "SLODefinition", entityId: id, metadataJson } });

export const listSloDefinitionsByProject = async (req: AuthRequest, res: Response) => {
  const ctx = await context(req, res); if (!ctx) return;
  const includeArchived = req.query.includeArchived === "true";
  const rows = await prisma.sLODefinition.findMany({
    where: { projectId: ctx.projectId, ...(!includeArchived ? { archivedAt: null } : {}), ...(typeof req.query.enabled === "string" ? { enabled: req.query.enabled === "true" } : {}) },
    include: { Service: true, SLOWindow: { orderBy: { windowEnd: "desc" }, take: 2 } }, orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }]
  });
  res.json(rows.map(row => ({ ...row, currentWindow: row.SLOWindow[0] ?? null, longWindow: row.SLOWindow[1] ?? null })));
};

export const createSloDefinitionByProject = async (req: AuthRequest, res: Response) => {
  const ctx = await context(req, res); if (!ctx) return;
  try {
    await assertWithinLimit(ctx.organizationId, ENTITLEMENT.SLOS_MAX);
  } catch (error) {
    if (handleEntitlementFailure(res, error)) return;
    throw error;
  }
  const data = await validate(res, req.body ?? {}, ctx.projectId); if (!data) return;
  const duplicate = await prisma.sLODefinition.findFirst({ where: { projectId: ctx.projectId, name: data.name, archivedAt: null }, select: { id: true } });
  if (duplicate) return void fail(res, 409, "DUPLICATE_SLO", "An active SLO with this name already exists");
  const id = randomUUID();
  const [row] = await prisma.$transaction([
    prisma.sLODefinition.create({ data: { id, projectId: ctx.projectId, ...data, updatedAt: new Date() }, include: { Service: true } }),
    audit(req.user?.sub, "SLO_CREATED", id, data)
  ]);
  res.status(201).json(row);
};

export const patchSloDefinitionByProject = async (req: AuthRequest, res: Response) => {
  const ctx = await context(req, res); if (!ctx) return;
  const existing = await prisma.sLODefinition.findFirst({ where: { id: req.params.sloId, projectId: ctx.projectId }, include: { Service: true } });
  if (!existing) return void fail(res, 404, "SLO_NOT_FOUND", "SLO definition not found");
  if (req.body?.archive === true) {
    const [row] = await prisma.$transaction([
      prisma.sLODefinition.update({ where: { id: existing.id }, data: { archivedAt: new Date(), enabled: false, updatedAt: new Date() } }),
      audit(req.user?.sub, "SLO_ARCHIVED", existing.id, existing)
    ]); return void res.json(row);
  }
  const data = await validate(res, { ...existing, ...req.body }, ctx.projectId); if (!data) return;
  const duplicate = await prisma.sLODefinition.findFirst({ where: { projectId: ctx.projectId, name: data.name, archivedAt: null, id: { not: existing.id } }, select: { id: true } });
  if (duplicate) return void fail(res, 409, "DUPLICATE_SLO", "An active SLO with this name already exists");
  const [row] = await prisma.$transaction([
    prisma.sLODefinition.update({ where: { id: existing.id }, data: { ...data, updatedAt: new Date() }, include: { Service: true } }),
    audit(req.user?.sub, "SLO_UPDATED", existing.id, { before: existing, after: data })
  ]);
  res.json(row);
};

export const deleteSloDefinitionByProject = async (req: AuthRequest, res: Response) => {
  const ctx = await context(req, res); if (!ctx) return;
  const existing = await prisma.sLODefinition.findFirst({ where: { id: req.params.sloId, projectId: ctx.projectId } });
  if (!existing) return void fail(res, 404, "SLO_NOT_FOUND", "SLO definition not found");
  const windows = await prisma.sLOWindow.count({ where: { sloDefinitionId: existing.id } });
  if (windows > 0) return void fail(res, 409, "SLO_HAS_HISTORY", "SLOs with evaluation history cannot be deleted; archive the definition instead", { windows });
  await prisma.$transaction([prisma.sLODefinition.delete({ where: { id: existing.id } }), audit(req.user?.sub, "SLO_DELETED", existing.id, existing)]);
  res.status(204).send();
};

export const listSloWindowsByProject = async (req: AuthRequest, res: Response) => {
  const ctx = await context(req, res); if (!ctx) return;
  const take = Math.max(1, Math.min(Number(req.query.take || 200), 500));
  const rows = await prisma.sLOWindow.findMany({ where: { projectId: ctx.projectId, ...(typeof req.query.sloDefinitionId === "string" ? { sloDefinitionId: req.query.sloDefinitionId } : {}), ...(typeof req.query.status === "string" ? { status: req.query.status } : {}) }, include: { SLODefinition: true }, orderBy: { windowEnd: "desc" }, take });
  res.json(rows);
};
