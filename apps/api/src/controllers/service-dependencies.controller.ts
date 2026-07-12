import { randomUUID } from "crypto";
import { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";

const DEPENDENCY_TYPES = ["RUNTIME", "DATA", "AUTH", "QUEUE", "EXTERNAL", "HIERARCHY"] as const;
const CRITICALITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

const fail = (res: Response, status: number, code: string, message: string, details?: unknown) =>
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });

const orgIdFor = (req: AuthRequest, res: Response) => {
  const orgId = req.user?.organizationId;
  if (!orgId) fail(res, 403, "ORGANIZATION_REQUIRED", "Organization required");
  return orgId ?? null;
};

const projectFor = async (projectId: string, organizationId: string) =>
  prisma.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true } });

const dependencyFor = async (id: string, projectId: string, organizationId: string) =>
  prisma.serviceDependency.findFirst({
    where: { id, projectId, Project: { organizationId } },
    include: { FromService: true, ToService: true }
  });

const createsCycle = async (projectId: string, fromId: string, toId: string, excludedId?: string) => {
  const edges = await prisma.serviceDependency.findMany({
    where: { projectId, isActive: true, ...(excludedId ? { id: { not: excludedId } } : {}) },
    select: { fromServiceId: true, toServiceId: true }
  });
  const graph = new Map<string, string[]>();
  for (const edge of [...edges, { fromServiceId: fromId, toServiceId: toId }]) {
    graph.set(edge.fromServiceId, [...(graph.get(edge.fromServiceId) ?? []), edge.toServiceId]);
  }
  const seen = new Set<string>();
  const visit = (node: string): boolean => {
    if (node === fromId) return true;
    if (seen.has(node)) return false;
    seen.add(node);
    return (graph.get(node) ?? []).some(visit);
  };
  return visit(toId);
};

const validate = async (res: Response, input: any, projectId: string, excludedId?: string) => {
  const fromServiceId = String(input.fromServiceId ?? "").trim();
  const toServiceId = String(input.toServiceId ?? "").trim();
  const dependencyType = String(input.dependencyType ?? "RUNTIME").toUpperCase();
  const criticality = String(input.criticality ?? "HIGH").toUpperCase();
  if (!fromServiceId || !toServiceId) {
    fail(res, 400, "VALIDATION_ERROR", "fromServiceId and toServiceId are required"); return null;
  }
  if (fromServiceId === toServiceId) {
    fail(res, 400, "SELF_DEPENDENCY", "A monitored area cannot depend on itself"); return null;
  }
  if (!DEPENDENCY_TYPES.includes(dependencyType as any)) {
    fail(res, 400, "UNSUPPORTED_DEPENDENCY_TYPE", "Unsupported dependency relationship", { supported: DEPENDENCY_TYPES }); return null;
  }
  if (!CRITICALITIES.includes(criticality as any)) {
    fail(res, 400, "UNSUPPORTED_CRITICALITY", "Unsupported criticality", { supported: CRITICALITIES }); return null;
  }
  const services = await prisma.service.count({ where: { id: { in: [fromServiceId, toServiceId] }, projectId } });
  if (services !== 2) {
    fail(res, 400, "INVALID_SERVICE", "Both monitored areas must belong to this project"); return null;
  }
  const duplicate = await prisma.serviceDependency.findFirst({
    where: { projectId, fromServiceId, toServiceId, dependencyType, ...(excludedId ? { id: { not: excludedId } } : {}) }, select: { id: true }
  });
  if (duplicate) {
    fail(res, 409, "DUPLICATE_DEPENDENCY", "This dependency relationship already exists"); return null;
  }
  if (input.isActive !== false && dependencyType !== "HIERARCHY" && await createsCycle(projectId, fromServiceId, toServiceId, excludedId)) {
    fail(res, 409, "DEPENDENCY_CYCLE", "This relationship would create a circular dependency chain"); return null;
  }
  return { fromServiceId, toServiceId, dependencyType, criticality, isActive: input.isActive !== undefined ? Boolean(input.isActive) : true };
};

const audit = (userId: string | undefined, action: string, id: string, metadataJson: any) =>
  prisma.auditLog.create({ data: { id: randomUUID(), userId, action, entityType: "ServiceDependency", entityId: id, metadataJson } });

export const listServiceDependenciesByProject = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdFor(req, res); if (!orgId) return;
  if (!await projectFor(String(req.params.projectId), orgId)) return void fail(res, 404, "PROJECT_NOT_FOUND", "Project not found");
  const rows = await prisma.serviceDependency.findMany({
    where: { projectId: String(req.params.projectId), ...(typeof req.query.isActive === "string" ? { isActive: req.query.isActive === "true" } : {}) },
    include: { FromService: true, ToService: true }, orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }]
  });
  res.json(rows);
};

export const createServiceDependencyByProject = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdFor(req, res); if (!orgId) return;
  if (!await projectFor(String(req.params.projectId), orgId)) return void fail(res, 404, "PROJECT_NOT_FOUND", "Project not found");
  const data = await validate(res, req.body ?? {}, String(req.params.projectId)); if (!data) return;
  const id = randomUUID();
  const [row] = await prisma.$transaction([
    prisma.serviceDependency.create({ data: { id, projectId: String(req.params.projectId), ...data, updatedAt: new Date() }, include: { FromService: true, ToService: true } }),
    audit(req.user?.sub, "SERVICE_DEPENDENCY_CREATED", id, data)
  ]);
  res.status(201).json(row);
};

export const patchServiceDependencyByProject = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdFor(req, res); if (!orgId) return;
  const existing = await dependencyFor(String(req.params.dependencyId), String(req.params.projectId), orgId);
  if (!existing) return void fail(res, 404, "DEPENDENCY_NOT_FOUND", "Dependency not found");
  const data = await validate(res, { ...existing, ...req.body }, existing.projectId, existing.id); if (!data) return;
  const [row] = await prisma.$transaction([
    prisma.serviceDependency.update({ where: { id: existing.id }, data: { ...data, updatedAt: new Date() }, include: { FromService: true, ToService: true } }),
    audit(req.user?.sub, "SERVICE_DEPENDENCY_UPDATED", existing.id, { before: existing, after: data })
  ]);
  res.json(row);
};

export const deleteServiceDependencyByProject = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdFor(req, res); if (!orgId) return;
  const existing = await dependencyFor(String(req.params.dependencyId), String(req.params.projectId), orgId);
  if (!existing) return void fail(res, 404, "DEPENDENCY_NOT_FOUND", "Dependency not found");
  const evidenceCount = await prisma.incidentTimelineEvent.count({ where: { sourceType: "SERVICE_DEPENDENCY", sourceId: existing.id } });
  if (evidenceCount > 0) return void fail(res, 409, "DEPENDENCY_IN_USE", "Dependency is referenced by incident correlation and cannot be deleted; disable it instead", { evidenceCount });
  await prisma.$transaction([
    prisma.serviceDependency.delete({ where: { id: existing.id } }),
    audit(req.user?.sub, "SERVICE_DEPENDENCY_DELETED", existing.id, existing)
  ]);
  res.status(204).send();
};
