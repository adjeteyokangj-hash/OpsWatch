import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";

const orgIdOr403 = (req: AuthRequest, res: Response): string | null => {
	const orgId = req.user?.organizationId;
	if (!orgId) {
		res.status(403).json({ error: "Organization required" });
		return null;
	}
	return orgId;
};

export const registerUser = async (req: AuthRequest, res: Response) => {
	const { name, email, password, organizationId } = req.body ?? {};
	if (!email || !password || !organizationId) {
		res.status(400).json({ error: "email, password, organizationId are required" });
		return;
	}
	const passwordHash = await bcrypt.hash(String(password), 10);
	const row = await prisma.user.create({
		data: {
			id: randomUUID(),
			name: String(name || email),
			email: String(email),
			passwordHash,
			organizationId: String(organizationId),
			role: "MEMBER",
			updatedAt: new Date()
		}
	});
	res.status(201).json({ id: row.id, email: row.email, name: row.name, role: row.role });
};

export const inviteUser = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;
	const { name, email, role } = req.body ?? {};
	if (!email) {
		res.status(400).json({ error: "email is required" });
		return;
	}
	const tempPasswordHash = await bcrypt.hash(randomUUID(), 10);
	const row = await prisma.user.create({
		data: {
			id: randomUUID(),
			name: String(name || email),
			email: String(email),
			role: role || "MEMBER",
			passwordHash: tempPasswordHash,
			organizationId: orgId,
			updatedAt: new Date()
		}
	});
	res.status(201).json({ id: row.id, email: row.email, name: row.name, role: row.role });
};

export const listUsers = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;
	const rows = await prisma.user.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" } });
	res.json(rows.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, isActive: u.isActive, createdAt: u.createdAt.toISOString() })));
};

export const getUserById = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;
	const row = await prisma.user.findFirst({ where: { id: req.params.userId, organizationId: orgId } });
	if (!row) {
		res.status(404).json({ error: "User not found" });
		return;
	}
	res.json({ id: row.id, name: row.name, email: row.email, role: row.role, isActive: row.isActive, createdAt: row.createdAt.toISOString() });
};

export const patchUser = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;
	const row = await prisma.user.findFirst({ where: { id: req.params.userId, organizationId: orgId }, select: { id: true } });
	if (!row) {
		res.status(404).json({ error: "User not found" });
		return;
	}
	const body = req.body ?? {};
	const updated = await prisma.user.update({
		where: { id: row.id },
		data: {
			...(body.name !== undefined ? { name: String(body.name) } : {}),
			...(body.role !== undefined ? { role: String(body.role) } : {}),
			...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
			updatedAt: new Date()
		}
	});
	res.json({ id: updated.id, name: updated.name, email: updated.email, role: updated.role, isActive: updated.isActive, createdAt: updated.createdAt.toISOString() });
};

export const deleteUser = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;
	const result = await prisma.user.deleteMany({ where: { id: req.params.userId, organizationId: orgId } });
	if (result.count === 0) {
		res.status(404).json({ error: "User not found" });
		return;
	}
	res.status(204).send();
};

