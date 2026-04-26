import { randomUUID } from "crypto";
import { Response } from "express";
import { prisma } from "../lib/prisma";
import { generateApiKey, generateSigningSecret } from "../utils/crypto";
import type { AuthRequest } from "../middleware/auth";

const normalizeProjectRow = (row: any) => ({
	...row,
	services: row.Service ?? [],
	alerts: row.Alert ?? [],
	incidents: row.Incident ?? [],
	heartbeats: row.Heartbeat ?? [],
	events: row.Event ?? [],
	integrations: row.ProjectIntegration ?? [],
	notificationChannels: row.NotificationChannel ?? []
});

const requireOrg = (req: AuthRequest, res: Response): string | null => {
	const orgId = req.user?.organizationId;
	if (!orgId) {
		res.status(403).json({ error: "Organization required" });
		return null;
	}
	return orgId;
};

export const listProjects = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const rows = await prisma.project.findMany({
		where: { organizationId: orgId },
		include: {
			Service: true,
			Alert: { where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } },
			Incident: { where: { status: { in: ["OPEN", "INVESTIGATING", "MONITORING"] } } },
			Heartbeat: { orderBy: { receivedAt: "desc" }, take: 1 }
		},
		orderBy: { createdAt: "desc" }
	});

	res.json(rows.map(normalizeProjectRow));
};

export const createProject = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const body = req.body ?? {};
	const name = String(body.name || "Untitled Project").trim();
	const slug = String(body.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));

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
			apiKey: generateApiKey(),
			signingSecret: generateSigningSecret(),
			updatedAt: new Date(),
			organizationId: orgId
		}
	});

	res.status(201).json(row);
};

export const getProjectById = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const row = await prisma.project.findFirst({
		where: { id: req.params.projectId, organizationId: orgId },
		include: {
			Service: true,
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
	res.json(normalizeProjectRow(row));
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
			...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
			updatedAt: new Date()
		}
	});

	res.json(row);
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
