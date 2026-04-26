import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { diagnose } from "../services/ai/incident-ai.service";
import { executeRemediation } from "../services/remediation/remediation.service";
import type { AuthRequest } from "../middleware/auth";

const orgIdOr403 = (req: AuthRequest, res: Response): string | null => {
	const orgId = req.user?.organizationId;
	if (!orgId) {
		res.status(403).json({ error: "Organization required" });
		return null;
	}
	return orgId;
};

export const suggestRemediation = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;

	const body = req.body ?? {};
	const diagnosis = diagnose({
		alertType: body.alertType,
		eventTypes: body.eventTypes,
		severity: body.severity,
		title: body.title,
		message: body.message
	});

	res.json({ organizationId: orgId, diagnosis });
};

export const executeRemediationAction = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;

	const { action, context = {}, approved = false, auto = false } = req.body ?? {};
	if (!action) {
		res.status(400).json({ error: "action is required" });
		return;
	}

	const result = await executeRemediation(action, { ...context, organizationId: orgId }, {
		approved: Boolean(approved),
		auto: Boolean(auto),
		executedBy: typeof req.user?.sub === "string" ? req.user.sub : undefined
	});
	res.json(result);
};

export const getRemediationLogs = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;

	const rows = await prisma.remediationLog.findMany({
		where: { organizationId: orgId },
		orderBy: { createdAt: "desc" },
		take: 200
	});
	res.json(rows);
};

export const approveRemediation = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;

	const row = await prisma.remediationLog.findFirst({
		where: { id: req.params.logId, organizationId: orgId }
	});
	if (!row) {
		res.status(404).json({ error: "Remediation log not found" });
		return;
	}

	const updated = await prisma.remediationLog.update({
		where: { id: row.id },
		data: {
			status: "APPROVED",
			approvedBy: typeof req.user?.sub === "string" ? req.user.sub : null,
			executedAt: new Date(),
			updatedAt: new Date()
		}
	});

	res.json(updated);
};

export const getRemediationAccuracy = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;

	const rows = await prisma.remediationLog.findMany({ where: { organizationId: orgId }, take: 500 });
	const total = rows.length;
	const success = rows.filter((r) => r.status === "SUCCEEDED").length;
	const failed = rows.filter((r) => r.status === "FAILED").length;
	res.json({ total, success, failed, accuracy: total ? Math.round((success / total) * 100) : 0 });
};

