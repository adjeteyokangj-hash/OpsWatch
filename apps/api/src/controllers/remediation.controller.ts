import { Response } from "express";
import { prisma } from "../lib/prisma";
import { executeRemediation } from "../services/remediation/remediation.service";
import { buildIncidentDiagnosis } from "../services/remediation/remediation-suggest.service";
import {
  buildAutoRunMetricsReport,
  buildRemediationAccuracyReport
} from "../services/operations-analytics.service";
import type { RemediationAction } from "../services/remediation/actions";
import {
  canExecuteRemediationAction,
  hasPermission
} from "../auth/permissions";
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
	if (!hasPermission(req.user?.role, "diagnosis:read")) {
		res.status(403).json({ error: "Forbidden" });
		return;
	}

	const body = req.body ?? {};
	try {
		const diagnosis = await buildIncidentDiagnosis(orgId, {
			incidentId: typeof body.incidentId === "string" ? body.incidentId : undefined,
			alertType: body.alertType,
			eventTypes: body.eventTypes,
			severity: body.severity,
			title: body.title,
			message: body.message
		});
		res.json(diagnosis);
	} catch (error: any) {
		if (error?.message === "Incident not found") {
			res.status(404).json({ error: "Incident not found" });
			return;
		}
		throw error;
	}
};

export const executeRemediationAction = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;

	const { action, context = {}, approved = false, auto = false, idempotencyKey } = req.body ?? {};
	if (!action) {
		res.status(400).json({ error: "action is required" });
		return;
	}

	if (!canExecuteRemediationAction(req.user?.role, action as RemediationAction, Boolean(approved))) {
		res.status(403).json({ error: "Forbidden", action });
		return;
	}

	const headerIdempotencyKey = req.header("Idempotency-Key")?.trim();
	const result = await executeRemediation(action, { ...context, organizationId: orgId }, {
		approved: Boolean(approved),
		auto: Boolean(auto),
		executedBy: typeof req.user?.sub === "string" ? req.user.sub : undefined,
		idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey : headerIdempotencyKey
	});
	res.json(result);
};

export const getRemediationLogs = async (req: AuthRequest, res: Response) => {
	const orgId = orgIdOr403(req, res);
	if (!orgId) return;

	const where: { organizationId: string; incidentId?: string; alertId?: string } = {
		organizationId: orgId
	};
	if (typeof req.query.incidentId === "string" && req.query.incidentId.trim()) {
		where.incidentId = req.query.incidentId.trim();
	}
	if (typeof req.query.alertId === "string" && req.query.alertId.trim()) {
		where.alertId = req.query.alertId.trim();
	}

	const rows = await prisma.remediationLog.findMany({
		where,
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

	res.json(await buildRemediationAccuracyReport(orgId));
};
