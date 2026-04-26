import { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { listIncidents, mapIncidentDetail } from "../services/incidents.service";

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

export const getIncidents = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const rows = await listIncidents(orgId, {
		projectId: typeof req.query.projectId === "string" ? req.query.projectId : undefined,
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

export const getIncidentById = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const row = await prisma.incident.findFirst({
		where: { id: req.params.incidentId, Project: { organizationId: orgId } },
		include: {
			Project: { select: { id: true, name: true, organizationId: true } },
			IncidentAlert: {
				include: {
					Alert: {
						include: {
							Service: { select: { id: true, name: true } }
						}
					}
				}
			}
		}
	});

	if (!row) {
		res.status(404).json({ error: "Incident not found" });
		return;
	}
	res.json(mapIncidentDetail(row as any));
};

export const patchIncident = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const existing = await prisma.incident.findFirst({
		where: { id: req.params.incidentId, Project: { organizationId: orgId } },
		select: { id: true }
	});
	if (!existing) {
		res.status(404).json({ error: "Incident not found" });
		return;
	}

	const body = req.body ?? {};
	const updated = await prisma.incident.update({
		where: { id: existing.id },
		data: {
			...(body.status !== undefined ? { status: body.status } : {}),
			...(body.title !== undefined ? { title: String(body.title) } : {}),
			...(body.severity !== undefined ? { severity: body.severity } : {}),
			...(body.rootCause !== undefined ? { rootCause: body.rootCause ? String(body.rootCause) : null } : {}),
			...(body.resolutionNotes !== undefined ? { resolutionNotes: body.resolutionNotes ? String(body.resolutionNotes) : null } : {}),
			...(body.status === "RESOLVED" ? { resolvedAt: new Date() } : {})
		}
	});

	res.json(updated);
};

