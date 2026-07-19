import { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import {
  getApmOverview,
  getLogsApmConnectionState,
  getProjectLog,
  getProjectTrace,
  listProjectLogGroups,
  searchProjectLogs
} from "../services/logs-apm/logs-apm-query.service";

const requireProjectOrg = async (req: AuthRequest, projectId: string) => {
  const orgId = req.user?.organizationId;
  if (!orgId) return { error: "Unauthorized" as const, project: null };
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId: orgId },
    select: { id: true, organizationId: true, environment: true, name: true }
  });
  if (!project?.organizationId) return { error: "Not found" as const, project: null };
  return { error: null, project: { ...project, organizationId: project.organizationId } };
};

const parseDate = (value: unknown): Date | undefined => {
  if (typeof value !== "string" || !value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const param = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? "" : value ?? "";

export const getLogsApmStatus = async (req: AuthRequest, res: Response) => {
  const projectId = param(req.params.projectId);
  const access = await requireProjectOrg(req, projectId);
  if (access.error || !access.project) {
    return res.status(access.error === "Unauthorized" ? 401 : 404).json({ error: access.error });
  }
  const status = await getLogsApmConnectionState({
    organizationId: access.project.organizationId,
    projectId: access.project.id
  });
  return res.json(status);
};

export const searchLogs = async (req: AuthRequest, res: Response) => {
  const projectId = param(req.params.projectId);
  const access = await requireProjectOrg(req, projectId);
  if (access.error || !access.project) {
    return res.status(access.error === "Unauthorized" ? 401 : 404).json({ error: access.error });
  }

  const environment =
    typeof req.query.environment === "string" ? req.query.environment : undefined;
  const result = await searchProjectLogs({
    organizationId: access.project.organizationId,
    projectId: access.project.id,
    environment,
    entityId: typeof req.query.entityId === "string" ? req.query.entityId : undefined,
    serviceName: typeof req.query.serviceName === "string" ? req.query.serviceName : undefined,
    severity: typeof req.query.severity === "string" ? req.query.severity : undefined,
    source: typeof req.query.source === "string" ? req.query.source : undefined,
    provider: typeof req.query.provider === "string" ? req.query.provider : undefined,
    text: typeof req.query.text === "string" ? req.query.text : undefined,
    traceId: typeof req.query.traceId === "string" ? req.query.traceId : undefined,
    spanId: typeof req.query.spanId === "string" ? req.query.spanId : undefined,
    correlationId: typeof req.query.correlationId === "string" ? req.query.correlationId : undefined,
    fingerprint: typeof req.query.fingerprint === "string" ? req.query.fingerprint : undefined,
    occurrenceGroupId:
      typeof req.query.occurrenceGroupId === "string" ? req.query.occurrenceGroupId : undefined,
    relatedAlertId: typeof req.query.relatedAlertId === "string" ? req.query.relatedAlertId : undefined,
    relatedIncidentId:
      typeof req.query.relatedIncidentId === "string" ? req.query.relatedIncidentId : undefined,
    attributeKey: typeof req.query.attributeKey === "string" ? req.query.attributeKey : undefined,
    attributeValue: typeof req.query.attributeValue === "string" ? req.query.attributeValue : undefined,
    from: parseDate(req.query.from),
    to: parseDate(req.query.to),
    cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    sort: req.query.sort === "asc" ? "asc" : "desc"
  });
  return res.json(result);
};

export const getLogById = async (req: AuthRequest, res: Response) => {
  const projectId = param(req.params.projectId);
  const logId = param(req.params.logId);
  const access = await requireProjectOrg(req, projectId);
  if (access.error || !access.project) {
    return res.status(access.error === "Unauthorized" ? 401 : 404).json({ error: access.error });
  }
  const result = await getProjectLog({
    organizationId: access.project.organizationId,
    projectId: access.project.id,
    logId
  });
  if (result.state === "NOT_FOUND") return res.status(404).json(result);
  return res.json(result);
};

export const getLogGroups = async (req: AuthRequest, res: Response) => {
  const projectId = param(req.params.projectId);
  const access = await requireProjectOrg(req, projectId);
  if (access.error || !access.project) {
    return res.status(access.error === "Unauthorized" ? 401 : 404).json({ error: access.error });
  }
  const result = await listProjectLogGroups({
    organizationId: access.project.organizationId,
    projectId: access.project.id,
    environment: typeof req.query.environment === "string" ? req.query.environment : undefined,
    status: typeof req.query.status === "string" ? req.query.status : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined
  });
  return res.json(result);
};

export const getApm = async (req: AuthRequest, res: Response) => {
  const projectId = param(req.params.projectId);
  const access = await requireProjectOrg(req, projectId);
  if (access.error || !access.project) {
    return res.status(access.error === "Unauthorized" ? 401 : 404).json({ error: access.error });
  }
  const overview = await getApmOverview({
    organizationId: access.project.organizationId,
    projectId: access.project.id,
    environment: typeof req.query.environment === "string" ? req.query.environment : undefined,
    windowSize: typeof req.query.windowSize === "string" ? req.query.windowSize : "5m"
  });
  return res.json(overview);
};

export const getTrace = async (req: AuthRequest, res: Response) => {
  const projectId = param(req.params.projectId);
  const traceId = param(req.params.traceId);
  const access = await requireProjectOrg(req, projectId);
  if (access.error || !access.project) {
    return res.status(access.error === "Unauthorized" ? 401 : 404).json({ error: access.error });
  }
  const trace = await getProjectTrace({
    organizationId: access.project.organizationId,
    projectId: access.project.id,
    traceId
  });
  if (!trace) return res.status(404).json({ error: "Trace not found", isPartial: true });
  return res.json(trace);
};
