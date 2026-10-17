import { Response } from "express";
import { z } from "zod";
import type { AuthRequest } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { deviceCredentialRejection, NIINAI_DEVICE_CREDENTIAL_PREFIX, parseDeviceHeartbeatPayload } from "../services/device-heartbeat";
import { ingestHeartbeat } from "../services/heartbeats.service";
import { bindMonitoringUser, parseSessionHeartbeat, verifyMonitoringTicket } from "../services/user-monitoring";

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

	const session = parseSessionHeartbeat(body.payload);
	if (session.kind === "invalid") {
		res.status(400).json({ error: session.reason });
		return;
	}

	if (parseDeviceHeartbeatPayload(body.payload).kind === "invalid") {
		res.status(400).json({ error: "Device heartbeat requires a UUID device id" });
		return;
	}

	if (req.apiKeyId) {
		const key = await prisma.orgApiKey.findUnique({
			where: { id: req.apiKeyId },
			select: { name: true }
		});
		const name = key?.name?.trim() ?? "";
		if (session.kind === "session" && name.startsWith(NIINAI_DEVICE_CREDENTIAL_PREFIX)) {
			const boundId = name.slice(NIINAI_DEVICE_CREDENTIAL_PREFIX.length).trim().toLowerCase();
			if (boundId !== session.value.installationId) {
				res.status(403).json({ error: "Device credential does not match this computer" });
				return;
			}
		} else {
			const rejection = deviceCredentialRejection(key?.name, body.payload);
			if (rejection) {
				res.status(403).json({ error: rejection });
				return;
			}
		}
	}

	let verifiedUserId: string | null = null;
	if (session.kind === "session") {
		verifiedUserId = await verifyMonitoringTicket(session.value.ticket);
		const bound = bindMonitoringUser(session.value.claimedUserId, verifiedUserId);
		if (!bound.ok) {
			res.status(403).json({ error: bound.reason });
			return;
		}
		verifiedUserId = bound.userId;
	}

	await ingestHeartbeat(project.id, body, { verifiedUserId });
	if (session.kind === "session") {
		console.info(session.value.ended ? "NiiNai user session ended" : "NiiNai user session recorded");
	}
	res.status(202).json({ ok: true });
};
