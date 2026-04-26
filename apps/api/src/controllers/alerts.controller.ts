import { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { listAlerts, mapAlertDetail } from "../services/checks.service";

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

export const getAlerts = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const rows = await listAlerts(orgId, {
		projectId: typeof req.query.projectId === "string" ? req.query.projectId : undefined,
		serviceId: typeof req.query.serviceId === "string" ? req.query.serviceId : undefined,
		severity: typeof req.query.severity === "string" ? (req.query.severity as any) : undefined,
		status: typeof req.query.status === "string" ? (req.query.status as any) : undefined,
		q: typeof req.query.q === "string" ? req.query.q : undefined,
		onlyOpen: req.query.onlyOpen === "true",
		onlyUnresolved: req.query.onlyUnresolved === "true",
		dateFrom: parseDateQuery(req.query.dateFrom),
		dateTo: parseDateQuery(req.query.dateTo)
	});

	res.json(rows);
};

export const getAlertById = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const row = await prisma.alert.findFirst({
		where: { id: req.params.alertId, Project: { organizationId: orgId } },
		include: {
			Project: { select: { id: true, name: true, organizationId: true } },
			Service: { select: { id: true, name: true } },
			User: { select: { id: true, name: true, email: true } },
			IncidentAlert: {
				include: {
					Incident: {
						select: { id: true, title: true, severity: true, status: true, openedAt: true }
					}
				}
			}
		}
	});

	if (!row) {
		res.status(404).json({ error: "Alert not found" });
		return;
	}

	res.json(mapAlertDetail(row as any));
};

export const acknowledgeAlert = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const row = await prisma.alert.findFirst({
		where: { id: req.params.alertId, Project: { organizationId: orgId } },
		select: { id: true, status: true }
	});
	if (!row) {
		res.status(404).json({ error: "Alert not found" });
		return;
	}

	const updated = await prisma.alert.update({
		where: { id: row.id },
		data: {
			status: row.status === "RESOLVED" ? row.status : "ACKNOWLEDGED",
			acknowledgedAt: new Date(),
			assignedToUserId: typeof req.user?.sub === "string" ? req.user.sub : null
		}
	});

	res.json(updated);
};

export const resolveAlert = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const row = await prisma.alert.findFirst({
		where: { id: req.params.alertId, Project: { organizationId: orgId } },
		select: { id: true }
	});
	if (!row) {
		res.status(404).json({ error: "Alert not found" });
		return;
	}

	const updated = await prisma.alert.update({
		where: { id: row.id },
		data: {
			status: "RESOLVED",
			resolvedAt: new Date(),
			lastSeenAt: new Date()
		}
	});

	res.json(updated);
};

