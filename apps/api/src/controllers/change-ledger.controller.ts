import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import {
  createChangeLedgerEntry,
  isChangeLedgerKind,
  toChangeLedgerDto
} from "../services/change-ledger.service";

const requireOrg = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

const asEvidence = (value: unknown): Record<string, unknown> | null | undefined => {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

export const listChangeLedger = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const rows = await prisma.changeLedgerEntry.findMany({
    where: {
      organizationId: orgId,
      ...(typeof req.query.projectId === "string" ? { projectId: req.query.projectId } : {}),
      ...(typeof req.query.kind === "string" && isChangeLedgerKind(req.query.kind) ? { kind: req.query.kind } : {})
    },
    include: {
      Project: { select: { id: true, name: true } },
      Service: { select: { id: true, name: true } },
      Connection: { select: { id: true, name: true } }
    },
    orderBy: { occurredAt: "desc" },
    take: limit
  });
  res.json(rows.map(toChangeLedgerDto));
};

export const createChangeLedger = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const body = req.body ?? {};
  if (!isChangeLedgerKind(body.kind)) {
    res.status(400).json({ error: "kind must be a supported ledger kind" });
    return;
  }
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  if (!summary) {
    res.status(400).json({ error: "summary is required" });
    return;
  }
  const evidence = asEvidence(body.evidence);
  if (evidence === null) {
    res.status(400).json({ error: "evidence must be an object" });
    return;
  }
  const projectId = typeof body.projectId === "string" ? body.projectId : null;
  const serviceId = typeof body.serviceId === "string" ? body.serviceId : null;
  const connectionId = typeof body.connectionId === "string" ? body.connectionId : null;
  const [project, service, connection] = await Promise.all([
    projectId ? prisma.project.findFirst({ where: { id: projectId, organizationId: orgId }, select: { id: true } }) : null,
    serviceId ? prisma.service.findFirst({ where: { id: serviceId, Project: { organizationId: orgId } }, select: { id: true, projectId: true } }) : null,
    connectionId ? prisma.connection.findFirst({ where: { id: connectionId, organizationId: orgId }, select: { id: true, projectId: true } }) : null
  ]);
  if ((projectId && !project) || (serviceId && !service) || (connectionId && !connection)) {
    res.status(400).json({ error: "Referenced project, service, or connection is not in your organization" });
    return;
  }
  if (projectId && service?.projectId && projectId !== service.projectId) {
    res.status(400).json({ error: "serviceId does not belong to projectId" });
    return;
  }
  if (projectId && connection?.projectId && projectId !== connection.projectId) {
    res.status(400).json({ error: "connectionId does not belong to projectId" });
    return;
  }
  const occurredAt = body.occurredAt ? new Date(String(body.occurredAt)) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    res.status(400).json({ error: "occurredAt must be a valid date" });
    return;
  }
  const row = await createChangeLedgerEntry({
    organizationId: orgId,
    projectId: projectId ?? service?.projectId ?? connection?.projectId ?? null,
    serviceId,
    connectionId,
    kind: body.kind,
    summary,
    actorType: "USER",
    actor: req.user?.id ?? null,
    source: "MANUAL",
    externalId: typeof body.externalId === "string" ? body.externalId : null,
    evidence,
    occurredAt
  });
  res.status(201).json(toChangeLedgerDto(row));
};
