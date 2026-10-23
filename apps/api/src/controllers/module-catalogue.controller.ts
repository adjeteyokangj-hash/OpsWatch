import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { CORE_MODULE_CATALOGUE, proposeProjectModules } from "../services/topology/module-catalogue.service";
import { customModuleSchema, customModuleUpdateSchema, moduleDecisionSchema, moduleDiscoverySchema, moduleKeySchema, moduleBindingSchema } from "@opswatch/shared";
import { listModuleDefinitions, decideModule, recordModuleAudit } from "../services/topology/module-assignment.service";
import { discoverProjectModules } from "../services/topology/module-discovery.service";

const safeFailure = (res: Response, error: unknown): void => {
  const code = (error as { code?: string })?.code;
  if (code === "P2002") { res.status(409).json({ error: "A matching record or recent discovery already exists. Refresh before retrying." }); return; }
  if (code === "P2034" || (error instanceof Error && error.message === "ASSIGNMENT_CONFLICT")) {
    res.status(409).json({ error: "Assignment changed. Refresh and review the latest evidence." }); return;
  }
  res.status(503).json({ error: "Module catalogue is temporarily unavailable. Check database migration readiness." });
};

export const getModuleCatalogue = async (req: AuthRequest, res: Response): Promise<void> => {
  const organizationId = req.user?.organizationId;
  if (!organizationId) { res.status(403).json({ error: "Organization required" }); return; }
  try { res.json({ catalogue: await listModuleDefinitions(organizationId), canManage: req.user?.role === "ADMIN" }); }
  catch (error) { safeFailure(res, error); }
};

export const createCustomModule = async (req: AuthRequest, res: Response): Promise<void> => {
  const organizationId = req.user?.organizationId;
  if (!organizationId || req.user?.role !== "ADMIN") { res.status(403).json({ error: "Administrator required" }); return; }
  const parsed = customModuleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid custom module", details: parsed.error.flatten() }); return; }
  if (CORE_MODULE_CATALOGUE.some(row => row.key === parsed.data.key)) { res.status(409).json({ error: "Platform module keys cannot be replaced" }); return; }
  try {
    const row = await prisma.$transaction(async tx => {
      const definition = await tx.moduleCatalogueDefinition.create({ data: { organizationId, ...parsed.data } });
      await recordModuleAudit(tx, { organizationId, userId: req.user?.sub ?? req.user?.id, moduleKey: definition.key, action: "MODULE_DEFINITION_CREATED" });
      return definition;
    });
    res.status(201).json(row);
  } catch (error) { safeFailure(res, error); }
};

const scopedProject = async (req: AuthRequest, res: Response) => {
  const organizationId = req.user?.organizationId;
  if (!organizationId) { res.status(403).json({ error: "Organization required" }); return null; }
  const project = await prisma.project.findFirst({ where: { id: String(req.params.projectId), organizationId }, select: { id: true } });
  if (!project) { res.status(404).json({ error: "Project not found" }); return null; }
  return { organizationId, projectId: project.id, userId: req.user?.sub ?? req.user?.id };
};

export const updateCustomModule = async (req: AuthRequest, res: Response): Promise<void> => {
  const organizationId = req.user?.organizationId;
  if (!organizationId || req.user?.role !== "ADMIN") { res.status(403).json({ error: "Administrator required" }); return; }
  const parsed = customModuleUpdateSchema.safeParse(req.body);
  if (!parsed.success || parsed.data.key !== req.params.moduleKey) { res.status(400).json({ error: "Invalid module update" }); return; }
  try {
    const { expectedVersion, ...data } = parsed.data;
    const count = await prisma.$transaction(async tx => {
      const result = await tx.moduleCatalogueDefinition.updateMany({ where: { organizationId, key: data.key, version: expectedVersion }, data: { ...data, version: { increment: 1 } } });
      if (result.count) await recordModuleAudit(tx, { organizationId, userId: req.user?.sub ?? req.user?.id, moduleKey: data.key, action: "MODULE_DEFINITION_UPDATED", metadata: { version: expectedVersion + 1, status: data.status } });
      return result.count;
    });
    if (!count) { res.status(409).json({ error: "Module is unavailable or has changed. Refresh before editing." }); return; }
    res.json({ updated: true });
  } catch (error) { safeFailure(res, error); }
};

export const reviewProjectModule = async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user?.role !== "ADMIN") { res.status(403).json({ error: "Administrator required" }); return; }
  const parsed = moduleDecisionSchema.safeParse(req.body);
  const key = moduleKeySchema.safeParse(req.params.moduleKey);
  if (!parsed.success || !key.success) { res.status(400).json({ error: "Invalid module decision" }); return; }
  try {
    const scope = await scopedProject(req, res);
    if (!scope) return;
    const definitions = await listModuleDefinitions(scope.organizationId);
    if (!definitions.some(row => row.key === key.data && (row.status === "ACTIVE" || parsed.data.state !== "APPROVED"))) { res.status(404).json({ error: "Module not found" }); return; }
    res.json(await decideModule({ ...scope, moduleKey: key.data, ...parsed.data }));
  } catch (error) { safeFailure(res, error); }
};

export const analyseProjectModules = async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user?.role !== "ADMIN") { res.status(403).json({ error: "Administrator required" }); return; }
  const parsed = moduleDiscoverySchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid discovery request" }); return; }
  try {
    const scope = await scopedProject(req, res);
    if (scope) res.json(await discoverProjectModules({ ...scope, ...parsed.data }));
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") {
      res.setHeader("Retry-After", "60");
      res.status(429).json({ error: "This application has already been analysed recently. Retry in one minute." });
    } else safeFailure(res, error);
  }
};

export const bindProjectModule = async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user?.role !== "ADMIN") { res.status(403).json({ error: "Administrator required" }); return; }
  const parsed = moduleBindingSchema.safeParse(req.body);
  const key = moduleKeySchema.safeParse(req.params.moduleKey);
  if (!parsed.success || !key.success) { res.status(400).json({ error: "Invalid component binding" }); return; }
  try {
    const scope = await scopedProject(req, res); if (!scope) return;
    const result = await prisma.$transaction(async tx => {
      const assignment = await tx.projectModuleAssignment.findUnique({ where: { organizationId_projectId_moduleKey: {
        organizationId: scope.organizationId, projectId: scope.projectId, moduleKey: key.data
      } } });
      if (!assignment || assignment.state !== "APPROVED" || assignment.updatedAt.toISOString() !== parsed.data.expectedUpdatedAt) throw new Error("ASSIGNMENT_CONFLICT");
      if (parsed.data.entityId) {
        const entity = await tx.operationalEntity.findFirst({ where: { id: parsed.data.entityId, organizationId: scope.organizationId,
          projectId: scope.projectId, entityType: "MODULE", lifecycle: "ACTIVE", confirmationState: "CONFIRMED", isTestSeed: false } });
        if (!entity) throw new Error("ASSIGNMENT_CONFLICT");
      }
      const row = await tx.projectModuleAssignment.update({ where: { id: assignment.id }, data: { verifiedEntityId: parsed.data.entityId } });
      await recordModuleAudit(tx, { ...scope, moduleKey: key.data, action: "MODULE_COMPONENT_BOUND", metadata: { entityId: parsed.data.entityId } });
      return row;
    }, { isolationLevel: "Serializable" });
    res.json(result);
  } catch (error) { safeFailure(res, error); }
};

/** Read-only discovery. A proposal is not a service, health check, or approved assignment. */
export const getProjectModuleCatalogue = async (req: AuthRequest, res: Response): Promise<void> => {
  const organizationId = req.user?.organizationId;
  if (!organizationId) {
    res.status(403).json({ error: "Organization required" });
    return;
  }
  const projectId = String(req.params.projectId);
  try {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true, name: true, description: true, frontendUrl: true }
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  // Owner-supplied description and configured URL are hints, not proof of deployed functionality.
  // URL hostname inspection is deliberately not a network probe.
  const proposals = proposeProjectModules({
    description: project.description?.trim() || project.name,
    publicUrl: project.frontendUrl ?? undefined
  });
  const sources = [
    project.description?.trim() ? "project_description" : "project_name",
    ...(project.frontendUrl?.trim() ? ["configured_public_url_hostname"] : [])
  ];
  const [catalogue, assignments, latestRun, verifiedComponents] = await Promise.all([
    listModuleDefinitions(organizationId),
    prisma.projectModuleAssignment.findMany({ where: { organizationId, projectId }, orderBy: { moduleKey: "asc" } }),
    prisma.moduleDiscoveryRun.findFirst({ where: { organizationId, projectId }, orderBy: { createdAt: "desc" } }),
    prisma.operationalEntity.findMany({ where: { organizationId, projectId, entityType: "MODULE", lifecycle: "ACTIVE", confirmationState: "CONFIRMED", isTestSeed: false },
      select: { id: true, name: true, health: true, lastSeenAt: true }, take: 200 })
  ]);
  const runEvidence = latestRun?.sourcesJson as { missing?: string[]; sources?: unknown[]; method?: string; aiState?: string } | null;
  res.json({
    projectId: project.id,
    catalogue,
    assignments,
    verifiedComponents,
    canManage: req.user?.role === "ADMIN",
    proposals,
    discovery: {
      state: latestRun?.status ?? "NOT_ANALYSED",
      sources: runEvidence?.sources ?? sources,
      method: runEvidence?.method ?? "NOT_RUN",
      aiState: runEvidence?.aiState ?? "NOT_REQUESTED",
      completedAt: latestRun?.completedAt ?? null,
      missingSources: runEvidence?.missing ?? [
        ...(!project.description?.trim() ? ["project_description"] : []),
        "public_url_inspection",
        "authorised_connected_api_capabilities"
      ],
      note: "Applicability proposals require owner approval. Runtime topology and monitoring remain separate."
    },
    latestRun
  });
  } catch (error) { safeFailure(res, error); }
};
