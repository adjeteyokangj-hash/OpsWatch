import { Response, Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { IntegrationType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../middleware/auth";

export const settingsRouter = Router();

const projectSelect = {
  id: true,
  name: true,
  slug: true
};

const getOrgId = (req: AuthRequest, res: Response): string | undefined => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return undefined;
  }
  return orgId;
};

const projectBelongsToOrg = async (projectId: string, organizationId: string): Promise<boolean> => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true }
  });
  return Boolean(project);
};

const notificationChannelSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  type: z.enum(["EMAIL", "WEBHOOK"]),
  name: z.string().min(2).max(80),
  target: z.string().min(3).max(500),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional()
});

const notificationChannelPatchSchema = notificationChannelSchema.partial().extend({
  projectId: z.string().uuid().nullable().optional()
});

const validateNotificationTarget = (type: "EMAIL" | "WEBHOOK", target: string): string | undefined => {
  if (type === "EMAIL") {
    const parsed = z.string().email().safeParse(target);
    if (!parsed.success) {
      return "target must be a valid email address for EMAIL channels";
    }
    return undefined;
  }

  const parsed = z.string().url().safeParse(target);
  if (!parsed.success) {
    return "target must be a valid URL for WEBHOOK channels";
  }
  return undefined;
};

const integrationConfigSchema = z.object({
  projectId: z.string().uuid(),
  type: z.nativeEnum(IntegrationType),
  name: z.string().min(2).max(80).optional(),
  enabled: z.boolean().optional(),
  configJson: z.record(z.string(), z.unknown()).optional(),
  secretRef: z.string().min(2).max(255).optional(),
  validationStatus: z.enum(["UNKNOWN", "VALID", "INVALID"]).optional(),
  validationMessage: z.string().max(500).optional()
});

const INTEGRATION_REQUIRED_KEYS: Record<IntegrationType, string[]> = {
  WEBHOOK: ["WEBHOOK_URL"],
  EMAIL: ["EMAIL_PROVIDER_HEALTHCHECK_URL"],
  STRIPE: ["STRIPE_API_KEY"],
  WORKER_PROVIDER: ["WORKER_RESTART_WEBHOOK_URL"],
  SERVICE_PROVIDER: ["SERVICE_RESTART_WEBHOOK_URL"],
  DEPLOYMENT_PROVIDER: ["DEPLOYMENT_ROLLBACK_WEBHOOK_URL"],
  STATUS_PROVIDER: ["PROVIDER_STATUS_URL"],
  RUNBOOK_PROVIDER: ["RUNBOOK_BASE_URL"]
};

const readConfigValue = (config: Record<string, unknown> | null | undefined, key: string): string | undefined => {
  const fromConfig = config?.[key];
  if (typeof fromConfig === "string" && fromConfig.trim().length > 0) {
    return fromConfig;
  }
  const fromEnv = process.env[key];
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  return undefined;
};

const connectivityProbe = async (url: string): Promise<{ ok: boolean; message: string }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    if (response.ok) {
      return { ok: true, message: `Connectivity probe succeeded (${response.status}).` };
    }
    return { ok: false, message: `Connectivity probe failed (${response.status}).` };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Connectivity probe error: ${message}` };
  } finally {
    clearTimeout(timeout);
  }
};

const validateIntegrationConnectivity = async (row: {
  type: IntegrationType;
  enabled: boolean;
  configJson: Record<string, unknown> | null;
}): Promise<{ status: "VALID" | "INVALID"; message: string }> => {
  if (!row.enabled) {
    return { status: "INVALID", message: "Integration is disabled." };
  }

  const requiredKeys = INTEGRATION_REQUIRED_KEYS[row.type] ?? [];
  const missing = requiredKeys.filter((key) => !readConfigValue(row.configJson, key));
  if (missing.length > 0) {
    return { status: "INVALID", message: `Missing required config: ${missing.join(", ")}` };
  }

  if (row.type === "STRIPE") {
    const key = readConfigValue(row.configJson, "STRIPE_API_KEY") as string;
    const base = readConfigValue(row.configJson, "STRIPE_API_BASE") ?? "https://api.stripe.com";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${base}/v1/balance`, {
        method: "GET",
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal
      });
      if (response.ok) {
        return { status: "VALID", message: "Stripe connectivity validated." };
      }
      return { status: "INVALID", message: `Stripe validation failed (${response.status}).` };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: "INVALID", message: `Stripe validation error: ${message}` };
    } finally {
      clearTimeout(timeout);
    }
  }

  const urlKeys = [
    "WEBHOOK_URL",
    "WORKER_RESTART_WEBHOOK_URL",
    "SERVICE_RESTART_WEBHOOK_URL",
    "DEPLOYMENT_ROLLBACK_WEBHOOK_URL",
    "PROVIDER_STATUS_URL",
    "RUNBOOK_BASE_URL",
    "EMAIL_PROVIDER_HEALTHCHECK_URL"
  ];
  const url = urlKeys
    .map((key) => readConfigValue(row.configJson, key))
    .find((value): value is string => Boolean(value));

  if (!url) {
    return { status: "VALID", message: "Required config present; no connectivity URL provided for active probe." };
  }

  const probe = await connectivityProbe(url);
  return {
    status: probe.ok ? "VALID" : "INVALID",
    message: probe.message
  };
};

settingsRouter.get("/settings", (_req, res) => {
  res.json({ ok: true });
});

settingsRouter.get("/settings/notifications", async (req: AuthRequest, res) => {
  const orgId = getOrgId(req, res);
  if (!orgId) return;

  const rows = await prisma.notificationChannel.findMany({
    where: { Project: { organizationId: orgId } },
    include: {
      Project: { select: projectSelect }
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }]
  });

  res.json(rows);
});

settingsRouter.post("/settings/notifications", async (req: AuthRequest, res) => {
  const orgId = getOrgId(req, res);
  if (!orgId) return;

  const body = notificationChannelSchema.parse(req.body);
  if (!body.projectId) {
    res.status(400).json({ error: "projectId is required for tenant-scoped notification channels" });
    return;
  }

  if (!(await projectBelongsToOrg(body.projectId, orgId))) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const targetValidation = validateNotificationTarget(body.type, body.target);
  if (targetValidation) {
    res.status(400).json({ error: targetValidation });
    return;
  }

  const idempotencyKey = req.header("Idempotency-Key")?.trim();
  if (idempotencyKey) {
    const existing = await prisma.notificationChannel.findFirst({
      where: {
        projectId: body.projectId,
        type: body.type,
        name: body.name,
        target: body.target,
        Project: { organizationId: orgId }
      },
      include: { Project: { select: projectSelect } }
    });

    if (existing) {
      res.status(200).json(existing);
      return;
    }
  }

  const row = await prisma.$transaction(async (tx) => {
    if (body.isDefault) {
      await tx.notificationChannel.updateMany({
        where: {
          projectId: body.projectId,
          isDefault: true
        },
        data: { isDefault: false, updatedAt: new Date() }
      });
    }

    return tx.notificationChannel.create({
      data: {
        id: randomUUID(),
        projectId: body.projectId,
        type: body.type,
        name: body.name,
        target: body.target,
        isDefault: body.isDefault ?? false,
        isActive: body.isActive ?? true,
        updatedAt: new Date()
      },
      include: {
        Project: { select: projectSelect }
      }
    });
  });

  res.status(201).json(row);
});

settingsRouter.patch("/settings/notifications/:channelId", async (req: AuthRequest, res) => {
  const orgId = getOrgId(req, res);
  if (!orgId) return;

  const body = notificationChannelPatchSchema.parse(req.body);
  const existing = await prisma.notificationChannel.findFirst({
    where: { id: req.params.channelId, Project: { organizationId: orgId } },
    select: { id: true, projectId: true, type: true }
  });
  if (!existing) {
    res.status(404).json({ error: "Notification channel not found" });
    return;
  }

  if (body.projectId === null) {
    res.status(400).json({ error: "projectId is required for tenant-scoped notification channels" });
    return;
  }
  if (body.projectId && !(await projectBelongsToOrg(body.projectId, orgId))) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const nextType = body.type ?? existing.type;
  const nextTarget = body.target;
  if (nextTarget !== undefined) {
    const targetValidation = validateNotificationTarget(nextType as "EMAIL" | "WEBHOOK", nextTarget);
    if (targetValidation) {
      res.status(400).json({ error: targetValidation });
      return;
    }
  }

  const row = await prisma.$transaction(async (tx) => {
    const nextProjectId = body.projectId ?? existing.projectId;
    if (body.isDefault === true && nextProjectId) {
      await tx.notificationChannel.updateMany({
        where: {
          projectId: nextProjectId,
          isDefault: true,
          id: { not: req.params.channelId }
        },
        data: { isDefault: false, updatedAt: new Date() }
      });
    }

    return tx.notificationChannel.update({
      where: { id: req.params.channelId },
      data: {
        ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
        ...(body.type ? { type: body.type } : {}),
        ...(body.name ? { name: body.name } : {}),
        ...(body.target ? { target: body.target } : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        updatedAt: new Date()
      },
      include: {
        Project: { select: projectSelect }
      }
    });
  });

  res.json(row);
});

settingsRouter.delete("/settings/notifications/:channelId", async (req: AuthRequest, res) => {
  const orgId = getOrgId(req, res);
  if (!orgId) return;

  const result = await prisma.notificationChannel.deleteMany({
    where: { id: req.params.channelId, Project: { organizationId: orgId } }
  });
  if (result.count === 0) {
    res.status(404).json({ error: "Notification channel not found" });
    return;
  }

  res.status(204).send();
});

settingsRouter.get("/settings/integrations", async (req: AuthRequest, res) => {
  const orgId = getOrgId(req, res);
  if (!orgId) return;

  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  const rows = await prisma.projectIntegration.findMany({
    where: {
      ...(projectId ? { projectId } : {}),
      Project: { organizationId: orgId }
    },
    include: {
      Project: { select: projectSelect }
    },
    orderBy: [{ projectId: "asc" }, { type: "asc" }]
  });

  res.json(rows);
});

settingsRouter.put("/settings/integrations/:projectId/:type", async (req: AuthRequest, res) => {
  const orgId = getOrgId(req, res);
  if (!orgId) return;

  const parsed = integrationConfigSchema.parse({
    ...req.body,
    projectId: req.params.projectId,
    type: req.params.type
  });

  if (!(await projectBelongsToOrg(parsed.projectId, orgId))) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const row = await prisma.projectIntegration.upsert({
    where: {
      projectId_type: {
        projectId: parsed.projectId,
        type: parsed.type
      }
    },
    update: {
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.enabled !== undefined ? { enabled: parsed.enabled } : {}),
      ...(parsed.configJson !== undefined
        ? { configJson: parsed.configJson as Prisma.InputJsonValue }
        : {}),
      ...(parsed.secretRef !== undefined ? { secretRef: parsed.secretRef } : {}),
      ...(parsed.validationStatus !== undefined ? { validationStatus: parsed.validationStatus } : {}),
      ...(parsed.validationMessage !== undefined ? { validationMessage: parsed.validationMessage } : {}),
      ...(parsed.validationStatus !== undefined || parsed.validationMessage !== undefined
        ? { lastValidatedAt: new Date() }
        : {})
    },
    create: {
      id: randomUUID(),
      projectId: parsed.projectId,
      type: parsed.type,
      name: parsed.name,
      enabled: parsed.enabled ?? true,
      configJson: parsed.configJson as Prisma.InputJsonValue | undefined,
      secretRef: parsed.secretRef,
      validationStatus: parsed.validationStatus ?? "UNKNOWN",
      validationMessage: parsed.validationMessage,
      updatedAt: new Date(),
      lastValidatedAt:
        parsed.validationStatus !== undefined || parsed.validationMessage !== undefined
          ? new Date()
          : undefined
    }
  });

  res.json(row);
});

settingsRouter.post("/settings/integrations/:projectId/:type/validate", async (req: AuthRequest, res) => {
  const orgId = getOrgId(req, res);
  if (!orgId) return;

  const parsed = integrationConfigSchema.pick({ projectId: true, type: true }).parse({
    projectId: req.params.projectId,
    type: req.params.type
  });

  const row = await prisma.projectIntegration.findFirst({
    where: {
      projectId: parsed.projectId,
      type: parsed.type,
      Project: { organizationId: orgId }
    },
    select: {
      id: true,
      type: true,
      enabled: true,
      configJson: true
    }
  });

  if (!row) {
    res.status(404).json({ error: "Integration config not found" });
    return;
  }

  const result = await validateIntegrationConnectivity({
    type: row.type,
    enabled: row.enabled,
    configJson: (row.configJson as Record<string, unknown> | null) ?? null
  });

  const updated = await prisma.projectIntegration.update({
    where: { id: row.id },
    data: {
      validationStatus: result.status,
      validationMessage: result.message,
      lastValidatedAt: new Date()
    }
  });

  res.json(updated);
});
