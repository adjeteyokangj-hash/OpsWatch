import { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import {
	getAutoRunPolicy as loadAutoRunPolicy,
	updateAutoRunPolicy as saveAutoRunPolicy
} from "../services/remediation/auto-run-policy.service";

const orgIdOr403 = (req: AuthRequest, res: Response): string | null => {
	const orgId = req.user?.organizationId;
	if (!orgId) {
		res.status(403).json({ error: "Organization required" });
		return null;
	}
	return orgId;
};

export const getAutoRunPolicy = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;
	res.json(await loadAutoRunPolicy(orgId));
};

export const updateAutoRunPolicy = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;
	const body = req.body ?? {};
	await saveAutoRunPolicy({
		organizationId: orgId,
		policyType: body.policyType,
		policyKey: body.policyKey || "",
		enabled: Boolean(body.enabled),
		updatedBy: typeof req.user?.sub === "string" ? req.user.sub : undefined
	});
	res.json(await loadAutoRunPolicy(orgId));
};

export const triggerAutoRun = async (_req: AuthRequest, res: Response) => {
	res.status(202).json({ accepted: true, message: "Auto-run trigger accepted" });
};

export const runIncidentAutoRemediation = async (_req: AuthRequest, res: Response) => {
	res.status(202).json({ accepted: true, message: "Incident auto-run trigger accepted" });
};

export const getAutoRunMetrics = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;
	const rows = await prisma.remediationLog.findMany({
		where: { organizationId: orgId, executionMode: "AUTOMATIC" },
		take: 500
	});
	res.json({ total: rows.length, succeeded: rows.filter((r) => r.status === "SUCCEEDED").length });
};

export const getRemediationAccuracyMetrics = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;
	const rows = await prisma.remediationLog.findMany({ where: { organizationId: orgId }, take: 500 });
	const success = rows.filter((r) => r.status === "SUCCEEDED").length;
	const failed = rows.filter((r) => r.status === "FAILED").length;
	res.json({ total: rows.length, success, failed });
};

