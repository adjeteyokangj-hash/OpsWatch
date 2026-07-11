import { Response } from "express";
import { z } from "zod";
import type { AuthRequest } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { ingestHeartbeat } from "../services/heartbeats.service";

const heartbeatBodySchema = z.object({
	projectSlug: z.string().min(1),
	environment: z.string().min(1),
	status: z.enum(["HEALTHY", "DEGRADED", "DOWN", "PAUSED"]),
	commitSha: z.string().optional(),
	appVersion: z.string().optional(),
	message: z.string().optional(),
	payload: z.record(z.unknown()).optional()
});

export const ingestHeartbeatController = async (req: AuthRequest, res: Response) => {
	const parsed = heartbeatBodySchema.safeParse(req.body ?? {});
	if (!parsed.success) {
		res.status(400).json({ error: "Invalid heartbeat payload", details: parsed.error.flatten() });
		return;
	}

	const body = parsed.data;
	const project = await prisma.project.findFirst({
		where: {
			slug: body.projectSlug,
			...(req.apiKeyOrganizationId ? { organizationId: req.apiKeyOrganizationId } : {}),
			...(req.apiKeyProjectId ? { id: req.apiKeyProjectId } : {})
		},
		select: { id: true }
	});

	if (!project) {
		res.status(404).json({ error: "Project not found for API key scope" });
		return;
	}

	await ingestHeartbeat(project.id, body);
	res.status(202).json({ ok: true });
};
