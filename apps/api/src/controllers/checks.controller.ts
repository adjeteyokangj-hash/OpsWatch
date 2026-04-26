import { randomUUID } from "crypto";
import { isIP } from "net";
import { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { getCheckDetail, listChecksWithSummary } from "../services/checks.service";

const parseDateQuery = (value: unknown): Date | undefined => {
	if (typeof value !== "string" || !value.trim()) return undefined;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return undefined;
	return date;
};

const requireOrg = (req: AuthRequest, res: Response): string | null => {
	const orgId = req.user?.organizationId;
	if (!orgId) {
		res.status(403).json({ error: "Organization required" });
		return null;
	}
	return orgId;
};

const isPrivateDevHost = (hostname: string): boolean => {
	const host = hostname.toLowerCase();
	if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
	if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return true;

	const ipVersion = isIP(host);
	if (ipVersion === 4) {
		const parts = host.split(".").map((value) => Number.parseInt(value, 10));
		if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) return true;
		const a = parts[0]!;
		const b = parts[1]!;
		if (a === 10 || a === 127 || a === 0) return true;
		if (a === 192 && b === 168) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 169 && b === 254) return true;
	}
	if (ipVersion === 6) {
		if (host === "::1") return true;
		if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
	}

	return false;
};

const validateSslServiceTarget = (targetUrl: string | null): string | null => {
	if (!targetUrl) {
		return "SSL checks require a service target URL.";
	}

	let parsed: URL;
	try {
		parsed = new URL(targetUrl);
	} catch {
		return "SSL checks require a valid URL target.";
	}

	if (parsed.protocol !== "https:") {
		return "SSL checks require an https:// target URL.";
	}

	if (isPrivateDevHost(parsed.hostname)) {
		return "SSL checks cannot target localhost or private/dev hosts.";
	}

	return null;
};

export const listChecks = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const rows = await listChecksWithSummary(orgId, {
		projectId: typeof req.query.projectId === "string" ? req.query.projectId : undefined,
		serviceId: typeof req.query.serviceId === "string" ? req.query.serviceId : undefined,
		latestStatus: typeof req.query.latestStatus === "string" ? req.query.latestStatus : undefined,
		isActive: typeof req.query.isActive === "string" ? req.query.isActive === "true" : undefined,
		dateFrom: parseDateQuery(req.query.dateFrom),
		dateTo: parseDateQuery(req.query.dateTo)
	});

	res.json(rows);
};

export const listCheckResults = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
	const checkId = typeof req.query.checkId === "string" ? req.query.checkId : undefined;

	const rows = await prisma.checkResult.findMany({
		where: {
			...(checkId ? { checkId } : {}),
			...(projectId ? { Check: { Service: { Project: { id: projectId, organizationId: orgId } } } } : { Check: { Service: { Project: { organizationId: orgId } } } })
		},
		orderBy: { checkedAt: "desc" },
		take: 200
	});

	res.json(rows);
};

export const getCheckById = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;
	const checkId = req.params.checkId;
	if (!checkId) {
		res.status(400).json({ error: "checkId is required" });
		return;
	}

	const row = await getCheckDetail(checkId, orgId);
	if (!row) {
		res.status(404).json({ error: "Check not found" });
		return;
	}
	res.json(row);
};

export const listProjectCheckResults = async (req: AuthRequest, res: Response) => {
	req.query.projectId = req.params.projectId;
	await listCheckResults(req, res);
};

export const listChecksByService = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;
	const rows = await prisma.check.findMany({
		where: { serviceId: req.params.serviceId, Service: { Project: { organizationId: orgId } } },
		include: { CheckResult: { orderBy: { checkedAt: "desc" }, take: 1 } },
		orderBy: { updatedAt: "desc" }
	});
	res.json(rows);
};

export const createCheckByService = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const service = await prisma.service.findFirst({
		where: { id: req.params.serviceId, Project: { organizationId: orgId } },
		select: { id: true, baseUrl: true }
	});
	if (!service) {
		res.status(404).json({ error: "Service not found" });
		return;
	}

	const body = req.body ?? {};
	const checkType = body.type || "HTTP";
	if (checkType === "SSL") {
		const error = validateSslServiceTarget(service.baseUrl);
		if (error) {
			res.status(400).json({ error });
			return;
		}
	}

	const row = await prisma.check.create({
		data: {
			id: randomUUID(),
			serviceId: service.id,
			name: String(body.name || "Untitled Check"),
			type: checkType,
			intervalSeconds: Number(body.intervalSeconds || 60),
			timeoutMs: Number(body.timeoutMs || 10000),
			expectedStatusCode: body.expectedStatusCode ? Number(body.expectedStatusCode) : null,
			expectedKeyword: body.expectedKeyword ? String(body.expectedKeyword) : null,
			failureThreshold: Number(body.failureThreshold || 3),
			recoveryThreshold: Number(body.recoveryThreshold || 2),
			configJson: body.configJson ?? null,
			isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
			updatedAt: new Date()
		}
	});

	res.status(201).json(row);
};

export const patchCheck = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const check = await prisma.check.findFirst({
		where: {
			id: req.params.checkId,
			serviceId: req.params.serviceId,
			Service: { Project: { organizationId: orgId } }
		},
		select: { id: true, type: true, Service: { select: { baseUrl: true } } }
	});

	if (!check) {
		res.status(404).json({ error: "Check not found" });
		return;
	}

	const body = req.body ?? {};
	const nextType = body.type !== undefined ? body.type : check.type;
	if (nextType === "SSL") {
		const error = validateSslServiceTarget(check.Service.baseUrl);
		if (error) {
			res.status(400).json({ error });
			return;
		}
	}

	const row = await prisma.check.update({
		where: { id: check.id },
		data: {
			...(body.name !== undefined ? { name: String(body.name) } : {}),
			...(body.type !== undefined ? { type: body.type } : {}),
			...(body.intervalSeconds !== undefined ? { intervalSeconds: Number(body.intervalSeconds) } : {}),
			...(body.timeoutMs !== undefined ? { timeoutMs: Number(body.timeoutMs) } : {}),
			...(body.expectedStatusCode !== undefined ? { expectedStatusCode: body.expectedStatusCode ? Number(body.expectedStatusCode) : null } : {}),
			...(body.expectedKeyword !== undefined ? { expectedKeyword: body.expectedKeyword ? String(body.expectedKeyword) : null } : {}),
			...(body.failureThreshold !== undefined ? { failureThreshold: Number(body.failureThreshold) } : {}),
			...(body.recoveryThreshold !== undefined ? { recoveryThreshold: Number(body.recoveryThreshold) } : {}),
			...(body.configJson !== undefined ? { configJson: body.configJson } : {}),
			...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
			updatedAt: new Date()
		}
	});

	res.json(row);
};

