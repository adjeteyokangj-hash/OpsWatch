import { randomBytes, randomUUID } from "crypto";
import { Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { sha256 } from "../utils/crypto";
import type { AuthRequest } from "../middleware/auth";
import { recordCredentialAudit } from "../services/credentials/credential-audit.service";

const ALLOWED_API_KEY_SCOPES = new Set([
  "events:write",
  "heartbeats:write",
  "alerts:read",
  "incidents:read",
  "projects:read"
]);

const EXPIRING_SOON_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

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

const topologyModes = new Set(["CENTRALISED", "DISTRIBUTED", "HYBRID"]);

type ApiKeyStatus = "ACTIVE" | "REVOKED" | "EXPIRED" | "EXPIRING_SOON" | "ROTATION_PENDING";

type ApiKeyListRow = {
  id: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
  graceExpiresAt: Date | null;
  projectId: string | null;
};

const toApiKeyStatus = (row: ApiKeyListRow, siblings: ApiKeyListRow[]): ApiKeyStatus => {
  const now = Date.now();
  if (row.revokedAt) return "REVOKED";
  if (row.graceExpiresAt) {
    if (row.graceExpiresAt.getTime() > now) return "ROTATION_PENDING";
    return "REVOKED";
  }
  if (row.expiresAt && row.expiresAt.getTime() <= now) return "EXPIRED";
  if (row.expiresAt && row.expiresAt.getTime() - now <= EXPIRING_SOON_MS) return "EXPIRING_SOON";
  const siblingInGrace = siblings.some(
    (candidate) =>
      candidate.id !== row.id &&
      candidate.projectId === row.projectId &&
      candidate.graceExpiresAt &&
      candidate.graceExpiresAt.getTime() > now &&
      !candidate.revokedAt
  );
  if (siblingInGrace) return "ROTATION_PENDING";
  return "ACTIVE";
};

const auditOrgApiKeyEvent = async (input: {
  organizationId: string;
  userId?: string | null;
  action: "CREDENTIAL_CREATED" | "CREDENTIAL_REVOKED" | "CREDENTIAL_ROTATED";
  entityId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> => {
  await recordCredentialAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: input.action,
    entityType: "OrgApiKey",
    entityId: input.entityId,
    metadata: input.metadata
  });
};

const isPrismaSchemaDriftError = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2021" || error.code === "P2022";
  }
  return false;
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
    topologyMode: row.topologyMode,
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
  if (body.topologyMode !== undefined && !topologyModes.has(String(body.topologyMode))) {
    res.status(400).json({ error: "topologyMode must be CENTRALISED, DISTRIBUTED, or HYBRID" });
    return;
  }

  const updated = await prisma.organization.update({
    where: { id: orgId },
    data: {
      ...(body.name !== undefined ? { name: String(body.name).trim() } : {}),
      ...(body.topologyMode !== undefined ? { topologyMode: String(body.topologyMode) } : {}),
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
    topologyMode: updated.topologyMode,
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

  try {
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
  } catch (error) {
    if (isPrismaSchemaDriftError(error)) {
      res.json([]);
      return;
    }
    throw error;
  }
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

  try {
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
        lastUsedRoute: row.lastUsedRoute ?? "N/A",
        lastUsedIp: row.lastUsedIp ?? "N/A",
        lastUsedUserAgent: row.lastUsedUserAgent ?? "N/A",
        expiresAt: row.expiresAt?.toISOString() ?? null,
        graceExpiresAt: row.graceExpiresAt?.toISOString() ?? null,
        revokedAt: row.revokedAt?.toISOString() ?? null,
        revokeReason: row.revokeReason,
        requests24h: 0,
        failedAttempts24h: 0,
        status: toApiKeyStatus(row, rows)
      }))
    );
  } catch (error) {
    if (isPrismaSchemaDriftError(error)) {
      res.json([]);
      return;
    }
    throw error;
  }
};

export const getApiKeyUsage = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;

  try {
    const activeKeys = await prisma.orgApiKey.count({
      where: {
        organizationId: orgId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      }
    });

    res.json({
      last24hRequests: 0,
      failedAuthAttempts: 0,
      activeKeys
    });
  } catch (error) {
    if (isPrismaSchemaDriftError(error)) {
      res.json({
        last24hRequests: 0,
        failedAuthAttempts: 0,
        activeKeys: 0
      });
      return;
    }
    throw error;
  }
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

  if (!scopes.every((scope) => ALLOWED_API_KEY_SCOPES.has(scope))) {
    res.status(400).json({ error: "One or more scopes are not allowed" });
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

  try {
    const created = await prisma.orgApiKey.create({
      data: {
        id: randomUUID(),
        organizationId: orgId,
        name,
        keyId,
        secretHash: sha256(secret),
        scopes,
        environment,
        projectId,
        expiresAt
      }
    });

    const project = created.projectId
      ? await prisma.project.findFirst({ where: { id: created.projectId, organizationId: orgId }, select: { id: true, name: true } })
      : null;

    await auditOrgApiKeyEvent({
      organizationId: orgId,
      userId: req.user?.id ?? req.user?.sub ?? null,
      action: "CREDENTIAL_CREATED",
      entityId: created.id,
      metadata: {
        keyId,
        scopes,
        environment,
        projectId: created.projectId ?? null
      }
    });

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
  } catch (error) {
    if (isPrismaSchemaDriftError(error)) {
      res.status(503).json({ error: "API key creation is temporarily unavailable. Please run latest database migrations and try again." });
      return;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      res.status(409).json({ error: "API key collision detected. Please retry." });
      return;
    }

    throw error;
  }
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
      revokeReason: req.body?.reason ? String(req.body.reason) : null
    }
  });

  await auditOrgApiKeyEvent({
    organizationId: orgId,
    userId: req.user?.id ?? req.user?.sub ?? null,
    action: "CREDENTIAL_REVOKED",
    entityId: row.id,
    metadata: {
      reason: req.body?.reason ? String(req.body.reason) : null
    }
  });

  res.json({ revoked: true });
};

export const rotateApiKey = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;

  const existing = await prisma.orgApiKey.findFirst({
    where: { id: req.params.keyId, organizationId: orgId }
  });

  if (!existing) {
    res.status(404).json({ error: "API key not found" });
    return;
  }

  if (existing.revokedAt) {
    res.status(409).json({ error: "Cannot rotate a revoked API key" });
    return;
  }

  const now = new Date();
  if (existing.expiresAt && existing.expiresAt <= now) {
    res.status(409).json({ error: "Cannot rotate an expired API key" });
    return;
  }

  const gracePeriodMs =
    typeof req.body?.gracePeriodMs === "number" && req.body.gracePeriodMs >= 0
      ? req.body.gracePeriodMs
      : DEFAULT_ROTATION_GRACE_MS;

  const keyId = `ow_${randomBytes(6).toString("hex")}`;
  const secret = randomBytes(24).toString("base64url");
  const graceExpiresAt = new Date(now.getTime() + gracePeriodMs);

  const created = await prisma.$transaction(async (tx) => {
    await tx.orgApiKey.update({
      where: { id: existing.id },
      data: {
        graceExpiresAt,
        revokeReason: "rotated"
      }
    });

    return tx.orgApiKey.create({
      data: {
        id: randomUUID(),
        organizationId: orgId,
        name: existing.name,
        keyId,
        secretHash: sha256(secret),
        scopes: existing.scopes ?? [],
        environment: existing.environment,
        projectId: existing.projectId,
        expiresAt: existing.expiresAt,
        allowCrossEnvironment: existing.allowCrossEnvironment,
        rotatedFromKeyId: existing.id
      }
    });
  });

  await auditOrgApiKeyEvent({
    organizationId: orgId,
    userId: req.user?.id ?? req.user?.sub ?? null,
    action: "CREDENTIAL_ROTATED",
    entityId: created.id,
    metadata: {
      previousKeyId: existing.id,
      graceExpiresAt: graceExpiresAt.toISOString(),
      keyId
    }
  });

  const project = created.projectId
    ? await prisma.project.findFirst({
        where: { id: created.projectId, organizationId: orgId },
        select: { id: true, name: true }
      })
    : null;

  res.status(201).json({
    id: created.id,
    keyId,
    key: `${keyId}.${secret}`,
    prefix: keyId.slice(0, 12),
    name: created.name,
    scopes: asScopes(created.scopes),
    environment: created.environment === "test" ? "test" : "live",
    project,
    expiresAt: created.expiresAt?.toISOString() ?? null,
    graceExpiresAt: graceExpiresAt.toISOString(),
    createdAt: created.createdAt.toISOString()
  });
};
