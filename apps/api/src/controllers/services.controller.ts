import { randomUUID } from "crypto";
import { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";

const requireOrg = (req: AuthRequest, res: Response): string | null => {
	const orgId = req.user?.organizationId;
	if (!orgId) {
		res.status(403).json({ error: "Organization required" });
		return null;
	}
	return orgId;
};

export const listServices = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;
	const rows = await prisma.service.findMany({
		where: { Project: { organizationId: orgId } },
		include: { Project: { select: { id: true, name: true, slug: true } } },
		orderBy: { createdAt: "desc" }
	});
	res.json(rows);
};

export const createService = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;
	const body = req.body ?? {};
	const projectId = String(body.projectId || "");

	const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: orgId }, select: { id: true } });
	if (!project) {
		res.status(404).json({ error: "Project not found" });
		return;
	}

	const row = await prisma.service.create({
		data: {
			id: randomUUID(),
			projectId,
			name: String(body.name || "Untitled Service"),
			type: body.type || "BACKEND",
			baseUrl: body.baseUrl ? String(body.baseUrl) : null,
			isCritical: body.isCritical !== undefined ? Boolean(body.isCritical) : false,
			updatedAt: new Date()
		}
	});
	res.status(201).json(row);
};

export const patchService = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;
	const existing = await prisma.service.findFirst({ where: { id: req.params.serviceId, Project: { organizationId: orgId } }, select: { id: true } });
	if (!existing) {
		res.status(404).json({ error: "Service not found" });
		return;
	}
	const body = req.body ?? {};
	const row = await prisma.service.update({
		where: { id: existing.id },
		data: {
			...(body.name !== undefined ? { name: String(body.name) } : {}),
			...(body.type !== undefined ? { type: body.type } : {}),
			...(body.baseUrl !== undefined ? { baseUrl: body.baseUrl ? String(body.baseUrl) : null } : {}),
			...(body.isCritical !== undefined ? { isCritical: Boolean(body.isCritical) } : {}),
			updatedAt: new Date()
		}
	});
	res.json(row);
};

export const deleteService = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;
	const result = await prisma.service.deleteMany({ where: { id: req.params.serviceId, Project: { organizationId: orgId } } });
	if (result.count === 0) {
		res.status(404).json({ error: "Service not found" });
		return;
	}
	res.status(204).send();
};

export const listServicesByProject = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;
	const rows = await prisma.service.findMany({
		where: { projectId: req.params.projectId, Project: { organizationId: orgId } },
		orderBy: { createdAt: "desc" }
	});
	res.json(rows);
};

export const createServiceByProject = async (req: AuthRequest, res: Response) => {
	req.body = { ...(req.body ?? {}), projectId: req.params.projectId };
	await createService(req, res);
};

