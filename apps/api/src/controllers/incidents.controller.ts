import { randomUUID } from "crypto";
import { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import {
	listIncidents,
	listIncidentRootCauseCandidates,
	listIncidentTimeline,
	mapIncidentDetail,
	getIncidentIntelligenceSummary,
	mergeIncidents,
	reopenIncident
} from "../services/incidents.service";
import { indexIncidentMemory } from "../services/ai/incident-memory.service";
import { buildIncidentDiagnosis } from "../services/remediation/remediation-suggest.service";

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
			Project: { select: { id: true, name: true, organizationId: true, projectOwner: true } },
			CorrelationGroup: {
				include: {
					Incidents: {
						include: { Project: { select: { id: true, name: true } } }
					}
				}
			},
			IncidentAlert: {
				include: {
					Alert: {
						include: {
							Service: { select: { id: true, name: true } }
						}
					}
				}
			},
			OtelIncidentEvidence: {
				orderBy: { observedAt: "desc" },
				take: 20,
				select: {
					id: true,
					evidenceKind: true,
					summary: true,
					confidence: true,
					traceId: true,
					spanId: true,
					propagationDirection: true,
					candidateRootCause: true,
					observedAt: true
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

export const getIncidentTimeline = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const take = Math.max(1, Math.min(Number(req.query.take || 200), 500));
	const rows = await listIncidentTimeline(orgId, String(req.params.incidentId), take);
	if (!rows) {
		res.status(404).json({ error: "Incident not found" });
		return;
	}

	res.json(rows);
};

export const getIncidentRootCauseCandidates = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const rows = await listIncidentRootCauseCandidates(orgId, String(req.params.incidentId));
	if (!rows) {
		res.status(404).json({ error: "Incident not found" });
		return;
	}

	res.json(rows);
};

export const getIncidentIntelligence = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const summary = await getIncidentIntelligenceSummary(orgId, String(req.params.incidentId));
	if (!summary) {
		res.status(404).json({ error: "Incident not found" });
		return;
	}

	res.json(summary);
};

export const postMergeIncident = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const targetIncidentId =
		typeof req.body?.targetIncidentId === "string" ? req.body.targetIncidentId : "";
	if (!targetIncidentId) {
		res.status(400).json({ error: "targetIncidentId is required" });
		return;
	}

	const result = await mergeIncidents(orgId, String(req.params.incidentId), targetIncidentId);
	if (!result.ok) {
		res.status(result.status).json({ error: result.error });
		return;
	}
	res.json({ ok: true });
};

export const postReopenIncident = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const result = await reopenIncident(orgId, String(req.params.incidentId));
	if (!result.ok) {
		res.status(result.status).json({ error: result.error });
		return;
	}
	res.json({ ok: true });
};

export const listChangeEvents = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const project = await prisma.project.findFirst({
		where: { id: req.params.projectId, organizationId: orgId },
		select: { id: true }
	});
	if (!project) {
		res.status(404).json({ error: "Project not found" });
		return;
	}

	const take = Math.max(1, Math.min(Number(req.query.take || 100), 500));
	const from = parseDateQuery(req.query.from);
	const to = parseDateQuery(req.query.to);

	const rows = await prisma.changeEvent.findMany({
		where: {
			organizationId: orgId,
			projectId: project.id,
			...(typeof req.query.serviceId === "string" ? { serviceId: req.query.serviceId } : {}),
			...(typeof req.query.incidentId === "string" ? { incidentId: req.query.incidentId } : {}),
			...(from || to
				? {
					occurredAt: {
						...(from ? { gte: from } : {}),
						...(to ? { lte: to } : {})
					}
				}
				: {})
		},
		orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
		take
	});

	res.json(rows);
};

export const createChangeEvent = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const project = await prisma.project.findFirst({
		where: { id: req.params.projectId, organizationId: orgId },
		select: { id: true }
	});
	if (!project) {
		res.status(404).json({ error: "Project not found" });
		return;
	}

	const body = req.body ?? {};
	if (!body.eventType || !body.summary) {
		res.status(400).json({ error: "eventType and summary are required" });
		return;
	}

	if (body.serviceId) {
		const serviceExists = await prisma.service.findFirst({
			where: { id: String(body.serviceId), projectId: project.id },
			select: { id: true }
		});
		if (!serviceExists) {
			res.status(400).json({ error: "serviceId is not part of this project" });
			return;
		}
	}

	if (body.incidentId) {
		const incidentExists = await prisma.incident.findFirst({
			where: { id: String(body.incidentId), projectId: project.id },
			select: { id: true }
		});
		if (!incidentExists) {
			res.status(400).json({ error: "incidentId is not part of this project" });
			return;
		}
	}

	const created = await prisma.changeEvent.create({
		data: {
			id: randomUUID(),
			organizationId: orgId,
			projectId: project.id,
			serviceId: body.serviceId ? String(body.serviceId) : null,
			incidentId: body.incidentId ? String(body.incidentId) : null,
			eventType: String(body.eventType),
			actor: body.actor ? String(body.actor) : null,
			summary: String(body.summary),
			detailsJson: body.detailsJson ?? null,
			occurredAt: body.occurredAt ? new Date(String(body.occurredAt)) : new Date()
		}
	});

	res.status(201).json(created);
};

export const patchIncident = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const existing = await prisma.incident.findFirst({
		where: { id: req.params.incidentId, Project: { organizationId: orgId } },
		select: { id: true, title: true, status: true, rootCause: true, resolutionNotes: true, acknowledgedAt: true, resolvedAt: true }
	});
	if (!existing) {
		res.status(404).json({ error: "Incident not found" });
		return;
	}

	const body = req.body ?? {};
	const nextStatus = body.status !== undefined ? body.status : undefined;
	const updated = await prisma.incident.update({
		where: { id: existing.id },
		data: {
			...(body.status !== undefined ? { status: body.status } : {}),
			...(body.title !== undefined ? { title: String(body.title) } : {}),
			...(body.severity !== undefined ? { severity: body.severity } : {}),
			...(body.rootCause !== undefined ? { rootCause: body.rootCause ? String(body.rootCause) : null } : {}),
			...(body.resolutionNotes !== undefined ? { resolutionNotes: body.resolutionNotes ? String(body.resolutionNotes) : null } : {}),
			...(nextStatus === "RESOLVED" ? { resolvedAt: new Date() } : {}),
			...(nextStatus === "OPEN" || nextStatus === "INVESTIGATING" || nextStatus === "MONITORING"
				? { resolvedAt: null }
				: {}),
			...(nextStatus === "INVESTIGATING" && !existing.acknowledgedAt ? { acknowledgedAt: new Date() } : {})
		}
	});

	if (body.status === "RESOLVED") {
		try {
			const diagnosis = await buildIncidentDiagnosis(orgId, { incidentId: updated.id });
			await indexIncidentMemory({
				organizationId: orgId,
				incidentId: updated.id,
				title: updated.title,
				category: diagnosis.category,
				diagnosisSummary: diagnosis.diagnosis,
				rootCause: updated.rootCause ?? diagnosis.rootCauseHypothesis,
				resolutionSummary: updated.resolutionNotes,
				resolvedAt: updated.resolvedAt,
				alerts: diagnosis.evidence
					.filter((row) => row.type === "ALERT")
					.map((row) => ({ title: row.summary, message: row.summary, sourceType: "ALERT" }))
			});
		} catch (error) {
			console.error("INCIDENT_MEMORY_INDEX_ERROR", error instanceof Error ? error.message : error);
		}
	}

	res.json(updated);
};

