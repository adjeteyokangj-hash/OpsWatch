import { randomUUID } from "crypto";
import { Response } from "express";
import { prisma } from "../lib/prisma";
import { generateApiKey, generateSigningSecret } from "../utils/crypto";
import type { AuthRequest } from "../middleware/auth";
import { hasPermission } from "../auth/permissions";
import { requireOrg } from "../lib/require-org";
import { enrichProjectRow, projectInclude } from "../services/project-loader.service";
import { createDefaultProjectBilling, updateProjectBilling } from "../services/project-billing.service";
import {
	projectHasProductInfo,
	provisionProjectIngestCredentials
} from "../services/project-ingest-credentials.service";

const normalizeProjectRow = (row: any) => {
	const { signingSecret: _signingSecret, apiKey: _apiKey, ...safeRow } = row;
	return {
		...safeRow,
		services: row.services ?? row.Service ?? [],
		alerts: row.alerts ?? row.Alert ?? [],
		incidents: row.incidents ?? row.Incident ?? [],
		heartbeats: row.heartbeats ?? row.Heartbeat ?? [],
		events: row.events ?? row.Event ?? [],
		integrations: row.integrations ?? row.ProjectIntegration ?? [],
		notificationChannels: row.notificationChannels ?? row.NotificationChannel ?? [],
		billing: row.billing ?? row.ProjectBilling ?? null
	};
};

export const listProjects = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const rows = await prisma.project.findMany({
		where: { organizationId: orgId },
		include: projectInclude,
		orderBy: { createdAt: "desc" }
	});

	const enriched = await Promise.all(
		rows.map(async (row) => {
			try {
				return normalizeProjectRow(await enrichProjectRow(row as any));
			} catch (error) {
				console.error("PROJECT_ENRICH_ERROR", {
					projectId: row.id,
					message: error instanceof Error ? error.message : String(error)
				});
				return normalizeProjectRow(row as any);
			}
		})
	);

	res.json(enriched);
};

export const createProject = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const body = req.body ?? {};
	const name = String(body.name || "Untitled Project").trim();
	const slug = String(body.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
	const now = new Date();

	const row = await prisma.project.create({
		data: {
			id: randomUUID(),
			name,
			slug,
			clientName: String(body.clientName || name),
			description: body.description ? String(body.description) : null,
			environment: String(body.environment || "production"),
			frontendUrl: body.frontendUrl ? String(body.frontendUrl) : null,
			backendUrl: body.backendUrl ? String(body.backendUrl) : null,
			repoUrl: body.repoUrl ? String(body.repoUrl) : null,
			projectOwner: body.projectOwner ? String(body.projectOwner) : null,
			operationalContact: body.operationalContact ? String(body.operationalContact) : null,
			defaultRegion: body.defaultRegion ? String(body.defaultRegion) : null,
			status: "UNKNOWN",
			healthReason: "Awaiting first completed check",
			healthSource: "project-create",
			monitoringEnabled: body.monitoringEnabled !== false,
			monitoringStartedAt: body.monitoringEnabled === false ? null : now,
			automationMode: typeof body.automationMode === "string" ? body.automationMode : "OBSERVE",
			apiKey: generateApiKey(),
			signingSecret: generateSigningSecret(),
			updatedAt: now,
			organizationId: orgId
		},
		include: projectInclude
	});

	await createDefaultProjectBilling(row.id, "FREE");

	if (hasPermission(req.user?.role, "policy:manage") && (body.billing || body.plan)) {
		const billingBody = body.billing ?? {};
		await updateProjectBilling({
			projectId: row.id,
			plan: billingBody.plan ?? body.plan,
			monthlyPrice: typeof billingBody.monthlyPrice === "number" ? billingBody.monthlyPrice : undefined,
			currency: typeof billingBody.currency === "string" ? billingBody.currency : undefined,
			billingStatus: billingBody.billingStatus,
			checkLimit: typeof billingBody.checkLimit === "number" || billingBody.checkLimit === null ? billingBody.checkLimit : undefined,
			userLimit: typeof billingBody.userLimit === "number" || billingBody.userLimit === null ? billingBody.userLimit : undefined,
			automationRunLimit:
				typeof billingBody.automationRunLimit === "number" || billingBody.automationRunLimit === null
					? billingBody.automationRunLimit
					: undefined,
			internalNotes: typeof billingBody.internalNotes === "string" ? billingBody.internalNotes : undefined,
			updatedById: typeof req.user?.sub === "string" ? req.user.sub : undefined
		});
	}

	const enriched = await prisma.project.findFirst({
		where: { id: row.id, organizationId: orgId },
		include: projectInclude
	});

	const normalized = normalizeProjectRow(await enrichProjectRow((enriched ?? row) as any));
	const ingestCredentials = await provisionProjectIngestCredentials({
		organizationId: orgId,
		projectId: row.id,
		projectName: row.name,
		projectSlug: row.slug,
		signingSecret: row.signingSecret,
		environment: row.environment === "development" || row.environment === "staging" ? "test" : "live"
	});

	res.status(201).json({
		...normalized,
		ingestCredentials
	});
};

export const getProjectById = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const row = await prisma.project.findFirst({
		where: { id: req.params.projectId, organizationId: orgId },
		include: {
			...projectInclude,
			Alert: { orderBy: { lastSeenAt: "desc" }, take: 100 },
			Incident: { orderBy: { openedAt: "desc" }, take: 50 },
			Heartbeat: { orderBy: { receivedAt: "desc" }, take: 50 },
			Event: { orderBy: { createdAt: "desc" }, take: 100 },
			ProjectIntegration: true,
			NotificationChannel: true
		}
	});

	if (!row) {
		res.status(404).json({ error: "Project not found" });
		return;
	}
	res.json(normalizeProjectRow(await enrichProjectRow(row as any)));
};

export const patchProject = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const existing = await prisma.project.findFirst({
		where: { id: req.params.projectId, organizationId: orgId },
		select: { id: true }
	});

	if (!existing) {
		res.status(404).json({ error: "Project not found" });
		return;
	}

	const body = req.body ?? {};
	const row = await prisma.project.update({
		where: { id: req.params.projectId },
		data: {
			...(body.name !== undefined ? { name: String(body.name) } : {}),
			...(body.slug !== undefined ? { slug: String(body.slug) } : {}),
			...(body.clientName !== undefined ? { clientName: String(body.clientName) } : {}),
			...(body.description !== undefined ? { description: body.description ? String(body.description) : null } : {}),
			...(body.environment !== undefined ? { environment: String(body.environment) } : {}),
			...(body.frontendUrl !== undefined ? { frontendUrl: body.frontendUrl ? String(body.frontendUrl) : null } : {}),
			...(body.backendUrl !== undefined ? { backendUrl: body.backendUrl ? String(body.backendUrl) : null } : {}),
			...(body.repoUrl !== undefined ? { repoUrl: body.repoUrl ? String(body.repoUrl) : null } : {}),
			...(body.projectOwner !== undefined ? { projectOwner: body.projectOwner ? String(body.projectOwner) : null } : {}),
			...(body.operationalContact !== undefined
				? { operationalContact: body.operationalContact ? String(body.operationalContact) : null }
				: {}),
			...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
			updatedAt: new Date()
		}
	});

	let ingestCredentials;
	if (
		projectHasProductInfo({
			name: row.name,
			clientName: row.clientName,
			frontendUrl: row.frontendUrl,
			backendUrl: row.backendUrl
		})
	) {
		ingestCredentials = await provisionProjectIngestCredentials({
			organizationId: orgId,
			projectId: row.id,
			projectName: row.name,
			projectSlug: row.slug,
			signingSecret: row.signingSecret,
			environment: row.environment === "development" || row.environment === "staging" ? "test" : "live"
		});
	}

	res.json({
		...normalizeProjectRow(row),
		...(ingestCredentials ? { ingestCredentials } : {})
	});
};

export const deleteProject = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const result = await prisma.project.deleteMany({
		where: { id: req.params.projectId, organizationId: orgId }
	});

	if (result.count === 0) {
		res.status(404).json({ error: "Project not found" });
		return;
	}
	res.status(204).send();
};
