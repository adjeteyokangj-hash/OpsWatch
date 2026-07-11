import { Response } from "express";
import { z } from "zod";
import type { AuthRequest } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { ingestEvent } from "../services/events.service";

const eventBodySchema = z.object({
	projectSlug: z.string().min(1),
	type: z.enum([
		"BOOKING_FAILED",
		"PAYMENT_FAILED",
		"WEBHOOK_FAILED",
		"EMAIL_FAILED",
		"AUTH_SPIKE",
		"CRON_MISSED",
		"GOOGLE_API_FAILED",
		"DEPLOYMENT_STARTED",
		"DEPLOYMENT_FINISHED",
		"SERVICE_DOWN",
		"HEARTBEAT_MISSED",
		"AUTH_FAILURE_SPIKE",
		"TRAFFIC_SPIKE",
		"WEBHOOK_SIGNATURE_FAILED",
		"DEPLOY_FAILED",
		"SSL_EXPIRING",
		"DOMAIN_EXPIRING"
	]),
	severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]),
	source: z.string().min(1),
	message: z.string().min(1),
	serviceId: z.string().optional(),
	fingerprint: z.string().optional(),
	payload: z.record(z.unknown()).optional()
});

const healthSnapshotSchema = z.object({
	projectSlug: z.string().min(1),
	appName: z.string().min(1),
	environment: z.string().min(1),
	version: z.string().min(1),
	commitSha: z.string().optional(),
	uptimeSeconds: z.number().nonnegative(),
	databaseConnected: z.boolean(),
	timestamp: z.string().optional()
});

const findProjectForApiKey = async (
	req: AuthRequest,
	projectSlug: string
): Promise<{ id: string } | null> => {
	return prisma.project.findFirst({
		where: {
			slug: projectSlug,
			...(req.apiKeyOrganizationId ? { organizationId: req.apiKeyOrganizationId } : {}),
			...(req.apiKeyProjectId ? { id: req.apiKeyProjectId } : {})
		},
		select: { id: true }
	});
};

export const ingestEventController = async (req: AuthRequest, res: Response) => {
	const parsed = eventBodySchema.safeParse(req.body ?? {});
	if (!parsed.success) {
		res.status(400).json({ error: "Invalid event payload", details: parsed.error.flatten() });
		return;
	}

	const body = parsed.data;
	const project = await findProjectForApiKey(req, body.projectSlug);
	if (!project) {
		res.status(404).json({ error: "Project not found for API key scope" });
		return;
	}

	await ingestEvent(project.id, body);
	res.status(202).json({ ok: true });
};

export const ingestHealthSnapshotController = async (req: AuthRequest, res: Response) => {
	const parsed = healthSnapshotSchema.safeParse(req.body ?? {});
	if (!parsed.success) {
		res.status(400).json({ error: "Invalid health snapshot payload", details: parsed.error.flatten() });
		return;
	}

	const body = parsed.data;
	const project = await findProjectForApiKey(req, body.projectSlug);
	if (!project) {
		res.status(404).json({ error: "Project not found for API key scope" });
		return;
	}

	await ingestEvent(project.id, {
		projectSlug: body.projectSlug,
		type: body.databaseConnected ? "DEPLOYMENT_FINISHED" : "SERVICE_DOWN",
		severity: body.databaseConnected ? "INFO" : "HIGH",
		source: "health-snapshot",
		message: body.databaseConnected
			? `${body.appName} health snapshot OK`
			: `${body.appName} health snapshot reports database disconnected`,
		payload: {
			appName: body.appName,
			environment: body.environment,
			version: body.version,
			commitSha: body.commitSha,
			uptimeSeconds: body.uptimeSeconds,
			databaseConnected: body.databaseConnected,
			timestamp: body.timestamp ?? new Date().toISOString()
		}
	});

	res.status(202).json({ ok: true });
};
