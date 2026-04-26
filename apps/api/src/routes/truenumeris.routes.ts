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

trueNumerisRouter.post(
  "/truenumeris/register",
  requireApiKeyScopes(["events:write", "heartbeats:write"]),
  async (req: AuthRequest, res) => {
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

      const targets = [
        { key: "admin" as const, name: "TrueNumeris Admin Portal", url: adminPortalUrl, critical: true },
        { key: "customer" as const, name: "TrueNumeris Customer Portal", url: customerPortalUrl, critical: true },
        { key: "backend" as const, name: "TrueNumeris Backend Health", url: backendHealthUrl, critical: true }
      ];

      const services = [] as Array<{ id: string; name: string; url: string }>;
      for (const target of targets) {
        const existingService = await tx.service.findFirst({
          where: { projectId: project.id, name: target.name },
          select: { id: true }
        });

        const service = existingService
          ? await tx.service.update({
              where: { id: existingService.id },
              data: {
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
          where: { serviceId: service.id, name: "HTTP Health Check" },
          select: { id: true }
        });

        if (existingCheck) {
          await tx.check.update({
            where: { id: existingCheck.id },
            data: {
              type: "HTTP",
              intervalSeconds: 60,
              timeoutMs: 10000,
              expectedStatusCode: 200,
              expectedKeyword: null,
              isActive: true,
              updatedAt: new Date()
            }
          });
        } else {
          await tx.check.create({
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
        }

        services.push({ id: service.id, name: service.name, url: target.url });
      }

      return { project, services };
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
        monitoredTargets: result.services
      }
    });
  }
);
