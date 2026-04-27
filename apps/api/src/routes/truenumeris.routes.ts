import { randomUUID } from "crypto";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireApiKeyScopes, type AuthRequest } from "../middleware/auth";
import { generateApiKey, generateSigningSecret } from "../utils/crypto";

export const trueNumerisRouter = Router();

type RegisterBody = {
  projectName?: string;
  environment?: string;
  adminPortalUrl?: string;
  customerPortalUrl?: string;
  backendHealthUrl?: string;
  opsWatchBaseUrl?: string;
  apiKey?: string;
};

const slugify = (value: string): string =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "truenumeris";

const normalizeUrl = (value: unknown): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.toString();
  } catch {
    return "";
  }
};

const toServiceType = (kind: "admin" | "customer" | "backend"): "FRONTEND" | "API" =>
  kind === "backend" ? "API" : "FRONTEND";

type RegisterTarget = {
  key: "admin" | "customer" | "backend";
  name: string;
  legacyNames: string[];
  url: string;
  critical: boolean;
};

const registerIntegration = async (req: AuthRequest, res: any) => {
  const orgId = req.apiKeyOrganizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return;
  }

  const body = (req.body ?? {}) as RegisterBody;
  const projectName = String(body.projectName || "TrueNumeris").trim() || "TrueNumeris";
  const environment = String(body.environment || "production").trim() || "production";

  const adminPortalUrl = normalizeUrl(body.adminPortalUrl);
  const customerPortalUrl = normalizeUrl(body.customerPortalUrl);
  const backendHealthUrl = normalizeUrl(body.backendHealthUrl);

  if (!adminPortalUrl || !customerPortalUrl || !backendHealthUrl) {
    res.status(400).json({
      error:
        "adminPortalUrl, customerPortalUrl, and backendHealthUrl must be valid absolute URLs"
    });
    return;
  }

  const projectSlugBase = slugify(projectName);

  const result = await prisma.$transaction(async (tx) => {
    let project = req.apiKeyProjectId
      ? await tx.project.findFirst({
          where: { id: req.apiKeyProjectId, organizationId: orgId }
        })
      : null;

    if (!project) {
      project = await tx.project.findFirst({
        where: { organizationId: orgId, name: projectName, environment }
      });
    }

    if (!project) {
      project = await tx.project.findFirst({
        where: { organizationId: orgId, slug: projectSlugBase }
      });
    }

    if (!project) {
      project = await tx.project.create({
        data: {
          id: randomUUID(),
          name: projectName,
          slug: projectSlugBase,
          clientName: projectName,
          description: "Auto-registered TrueNumeris monitored endpoints",
          environment,
          frontendUrl: customerPortalUrl,
          backendUrl: backendHealthUrl,
          apiKey: generateApiKey(),
          signingSecret: generateSigningSecret(),
          updatedAt: new Date(),
          organizationId: orgId
        }
      });
    } else {
      project = await tx.project.update({
        where: { id: project.id },
        data: {
          name: projectName,
          clientName: projectName,
          environment,
          frontendUrl: customerPortalUrl,
          backendUrl: backendHealthUrl,
          updatedAt: new Date()
        }
      });
    }

    await tx.projectIntegration.upsert({
      where: { projectId_type: { projectId: project.id, type: "SERVICE_PROVIDER" } },
      create: {
        id: randomUUID(),
        projectId: project.id,
        type: "SERVICE_PROVIDER",
        name: "TrueNumeris endpoints",
        enabled: true,
        configJson: {
          adminPortalUrl,
          customerPortalUrl,
          backendHealthUrl,
          source: "truenumeris-register"
        },
        updatedAt: new Date()
      },
      update: {
        enabled: true,
        name: "TrueNumeris endpoints",
        configJson: {
          adminPortalUrl,
          customerPortalUrl,
          backendHealthUrl,
          source: "truenumeris-register"
        },
        updatedAt: new Date()
      }
    });

    const targets: RegisterTarget[] = [
      {
        key: "admin",
        name: "Admin Portal",
        legacyNames: ["TrueNumeris Admin Portal"],
        url: adminPortalUrl,
        critical: true
      },
      {
        key: "customer",
        name: "Customer Portal",
        legacyNames: ["TrueNumeris Customer Portal"],
        url: customerPortalUrl,
        critical: true
      },
      {
        key: "backend",
        name: "Backend API",
        legacyNames: ["TrueNumeris Backend Health"],
        url: backendHealthUrl,
        critical: true
      }
    ];

    const services: Array<{
      id: string;
      name: string;
      url: string;
      action: "created" | "updated";
    }> = [];
    const checks: Array<{
      id: string;
      serviceId: string;
      name: string;
      intervalSeconds: number;
      expectedStatusCode: number;
      action: "created" | "updated";
    }> = [];

    for (const target of targets) {
      const candidateNames = [target.name, ...target.legacyNames];
      const existingService = await tx.service.findFirst({
        where: {
          projectId: project.id,
          OR: [{ name: { in: candidateNames } }, { baseUrl: target.url }]
        },
        select: { id: true }
      });

      const serviceAction: "created" | "updated" = existingService ? "updated" : "created";
      const service = existingService
        ? await tx.service.update({
            where: { id: existingService.id },
            data: {
              name: target.name,
              type: toServiceType(target.key),
              baseUrl: target.url,
              isCritical: target.critical,
              status: "HEALTHY",
              updatedAt: new Date()
            }
          })
        : await tx.service.create({
            data: {
              id: randomUUID(),
              projectId: project.id,
              name: target.name,
              type: toServiceType(target.key),
              status: "HEALTHY",
              baseUrl: target.url,
              isCritical: target.critical,
              updatedAt: new Date()
            }
          });

      const existingCheck = await tx.check.findFirst({
        where: { serviceId: service.id, type: "HTTP" },
        select: { id: true }
      });

      const checkAction: "created" | "updated" = existingCheck ? "updated" : "created";
      const check = existingCheck
        ? await tx.check.update({
            where: { id: existingCheck.id },
            data: {
              name: "HTTP Health Check",
              type: "HTTP",
              intervalSeconds: 60,
              timeoutMs: 10000,
              expectedStatusCode: 200,
              expectedKeyword: null,
              isActive: true,
              updatedAt: new Date()
            }
          })
        : await tx.check.create({
            data: {
              id: randomUUID(),
              serviceId: service.id,
              name: "HTTP Health Check",
              type: "HTTP",
              intervalSeconds: 60,
              timeoutMs: 10000,
              expectedStatusCode: 200,
              expectedKeyword: null,
              failureThreshold: 3,
              recoveryThreshold: 2,
              isActive: true,
              updatedAt: new Date()
            }
          });

      services.push({ id: service.id, name: service.name, url: target.url, action: serviceAction });
      checks.push({
        id: check.id,
        serviceId: service.id,
        name: check.name,
        intervalSeconds: check.intervalSeconds,
        expectedStatusCode: check.expectedStatusCode ?? 200,
        action: checkAction
      });
    }

    return { project, services, checks };
  });

  res.status(200).json({
    ok: true,
    data: {
      project: {
        id: result.project.id,
        name: result.project.name,
        slug: result.project.slug,
        environment: result.project.environment
      },
      monitoredTargets: result.services,
      services: result.services,
      checks: result.checks
    }
  });
};

trueNumerisRouter.post(
  "/truenumeris/register",
  requireApiKeyScopes(["events:write"]),
  registerIntegration
);

trueNumerisRouter.post(
  "/integrations/opswatch/register",
  requireApiKeyScopes(["events:write"]),
  registerIntegration
);
