import { randomBytes, randomUUID } from "crypto";
import { Response } from "express";
import { prisma } from "../lib/prisma";
import { sha256 } from "../utils/crypto";
import type { AuthRequest } from "../middleware/auth";

const orgIdOr403 = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

const asScopes = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
};

const toApiKeyStatus = (row: { revokedAt: Date | null; expiresAt: Date | null }): "ACTIVE" | "REVOKED" | "EXPIRED" => {
  if (row.revokedAt) return "REVOKED";
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return "EXPIRED";
  return "ACTIVE";
};

export const getOrg = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;

  const row = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      _count: {
        select: {
          User: true,
          Project: true
        }
      }
    }
  });

  if (!row) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  res.json({
    id: row.id,
    name: row.name,
    slug: row.slug,
    plan: row.plan,
    isActive: row.isActive,
    _count: {
      users: row._count.User,
      projects: row._count.Project
    }
  });
};

export const createOrg = async (_req: AuthRequest, res: Response) => {
  res.status(405).json({ error: "Organization creation is not supported from this endpoint" });
};

export const patchOrg = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;

  const body = req.body ?? {};
  if (body.name !== undefined && (!String(body.name).trim() || String(body.name).length > 120)) {
    res.status(400).json({ error: "name must be between 1 and 120 characters" });
    return;
  }

  const updated = await prisma.organization.update({
    where: { id: orgId },
    data: {
      ...(body.name !== undefined ? { name: String(body.name).trim() } : {}),
      updatedAt: new Date()
    },
    include: {
      _count: {
        select: {
          User: true,
          Project: true
        }
      }
    }
  });

  res.json({
    id: updated.id,
    name: updated.name,
    slug: updated.slug,
    plan: updated.plan,
    isActive: updated.isActive,
    _count: {
      users: updated._count.User,
      projects: updated._count.Project
    }
  });
};

export const listStatusPages = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;

  const rows = await prisma.statusPage.findMany({
    where: { organizationId: orgId },
    include: {
      Project: {
        select: { id: true, name: true, slug: true }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  res.json(
    rows.map((row) => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      description: row.description,
      isPublic: row.isPublic,
      project: row.Project
    }))
  );
};

export const createStatusPage = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;

  const body = req.body ?? {};
  const title = String(body.title || "").trim();
  const slug = String(body.slug || "").trim().toLowerCase();

  if (!title || !slug) {
    res.status(400).json({ error: "title and slug are required" });
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

  try {
    const created = await prisma.statusPage.create({
      data: {
        id: randomUUID(),
        organizationId: orgId,
        projectId,
        title,
        slug,
        description: body.description ? String(body.description) : null,
        isPublic: body.isPublic !== undefined ? Boolean(body.isPublic) : true,
        updatedAt: new Date()
      },
      include: {
        Project: {
          select: { id: true, name: true, slug: true }
        }
      }
    });

    res.status(201).json({
      id: created.id,
      title: created.title,
      slug: created.slug,
      description: created.description,
      isPublic: created.isPublic,
      project: created.Project
    });
  } catch (error: any) {
    if (error?.code === "P2002") {
      res.status(409).json({ error: "A status page with this slug already exists" });
      return;
    }
    throw error;
  }
};

export const listApiKeys = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;

  const rows = await prisma.orgApiKey.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" }
  });

  const projectIds = rows.map((row) => row.projectId).filter((value): value is string => Boolean(value));
  const projects = projectIds.length
    ? await prisma.project.findMany({ where: { id: { in: projectIds }, organizationId: orgId }, select: { id: true, name: true } })
    : [];
  const projectById = new Map(projects.map((project) => [project.id, project]));

  res.json(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      keyId: row.keyId,
      prefix: row.keyId ? row.keyId.slice(0, 12) : "",
      scopes: asScopes(row.scopes),
      environment: row.environment === "test" ? "test" : "live",
      project: row.projectId ? projectById.get(row.projectId) ?? null : null,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      lastUsedRoute: row.lastUsedRoute,
      lastUsedIp: row.lastUsedIp,
      lastUsedUserAgent: row.lastUsedUserAgent,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      revokeReason: row.revokeReason,
      requests24h: 0,
      failedAttempts24h: 0,
      status: toApiKeyStatus(row)
    }))
  );
};

export const getApiKeyUsage = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;

  const activeKeys = await prisma.orgApiKey.count({
    where: {
      organizationId: orgId,
      revokedAt: null,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    }
  });

  res.json({
    last24hRequests: 0,
    failedAuthAttempts: 0,
    activeKeys
  });
};

export const createApiKey = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;

  const body = req.body ?? {};
  const name = String(body.name || "").trim();
  const scopes = asScopes(body.scopes);
  const environment = body.environment === "test" ? "test" : "live";

  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  if (scopes.length === 0) {
    res.status(400).json({ error: "At least one scope is required" });
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

  const expiresAt = body.expiresAt ? new Date(String(body.expiresAt)) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    res.status(400).json({ error: "expiresAt must be a valid date" });
    return;
  }

  const keyId = `ow_${randomBytes(6).toString("hex")}`;
  const secret = randomBytes(24).toString("base64url");

  const created = await prisma.orgApiKey.create({
    data: {
      id: randomUUID(),
      organizationId: orgId,
      name,
      keyHash: sha256(`${keyId}.${secret}`),
      keyId,
      secretHash: sha256(secret),
      scopes,
      environment,
      projectId,
      expiresAt,
      isActive: true
    }
  });

  const project = created.projectId
    ? await prisma.project.findFirst({ where: { id: created.projectId, organizationId: orgId }, select: { id: true, name: true } })
    : null;

  res.status(201).json({
    id: created.id,
    keyId,
    key: `${keyId}.${secret}`,
    prefix: keyId.slice(0, 12),
    name: created.name,
    scopes,
    environment,
    project,
    expiresAt: created.expiresAt?.toISOString() ?? null,
    createdAt: created.createdAt.toISOString()
  });
};

export const revokeApiKey = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;

  const row = await prisma.orgApiKey.findFirst({
    where: { id: req.params.keyId, organizationId: orgId },
    select: { id: true, revokedAt: true }
  });

  if (!row) {
    res.status(404).json({ error: "API key not found" });
    return;
  }

  if (row.revokedAt) {
    res.status(200).json({ revoked: true });
    return;
  }

  await prisma.orgApiKey.update({
    where: { id: row.id },
    data: {
      revokedAt: new Date(),
      revokeReason: req.body?.reason ? String(req.body.reason) : null,
      isActive: false
    }
  });

  res.json({ revoked: true });
};
