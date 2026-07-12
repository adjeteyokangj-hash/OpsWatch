import { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { canTriggerAutoHeal } from "../auth/permissions";
import {
	getAutoRunPolicy as loadAutoRunPolicy,
	updateAutoRunPolicy as saveAutoRunPolicy
} from "../services/remediation/auto-run-policy.service";
import { runAutoHealSweep, runIncidentAutoHeal } from "../services/remediation/auto-heal.service";
import { buildAutoRunMetricsReport, buildRemediationAccuracyReport } from "../services/operations-analytics.service";

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

export const triggerAutoRun = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;
	if (!canTriggerAutoHeal(req.user?.role)) {
		res.status(403).json({ error: "Forbidden" });
		return;
	}
	const results = await runAutoHealSweep(orgId);
	res.status(202).json({
		accepted: true,
		scanned: results.length,
		attempted: results.filter((row) => row.attempted).length,
		results
	});
};

export const runIncidentAutoRemediation = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;
	if (!canTriggerAutoHeal(req.user?.role)) {
		res.status(403).json({ error: "Forbidden" });
		return;
	}

	const incident = await prisma.incident.findFirst({
		where: { id: req.params.incidentId, Project: { organizationId: orgId } },
		select: { id: true }
	});
	if (!incident) {
		res.status(404).json({ error: "Incident not found" });
		return;
	}

	const result = await runIncidentAutoHeal(orgId, incident.id);
	res.status(result.attempted ? 200 : 202).json(result);
};

export const getAutoRunMetrics = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;
	res.json(await buildAutoRunMetricsReport(orgId));
};

export const getRemediationAccuracyMetrics = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;
	res.json(await buildRemediationAccuracyReport(orgId));
};
