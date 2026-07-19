import { randomUUID } from "crypto";
import { Response } from "express";
import { prisma } from "../lib/prisma";
import { generateApiKey, generateSigningSecret } from "../utils/crypto";
import type { AuthRequest } from "../middleware/auth";
import { hasPermission } from "../auth/permissions";
import { requireOrg } from "../lib/require-org";
import { isPrismaSchemaDriftError, isPrismaUniqueViolation } from "../lib/prisma-errors";
import { handleEntitlementFailure } from "./subscription.controller";
import { assertWithinLimit } from "../services/entitlements/entitlement.service";
import { ENTITLEMENT } from "../services/entitlements/entitlement-keys";
import {
	enrichProjectRow,
	projectInclude,
	projectIncludeLite
} from "../services/project-loader.service";
import { createDefaultProjectBilling, updateProjectBilling } from "../services/project-billing.service";
import {
	provisionProjectIngestCredentials,
	provisionProjectSigningSecret,
	type ProvisionedIngestCredentials
} from "../services/project-ingest-credentials.service";
import {
	normalizeMonitoringUrl,
	reconcileProjectUrlMonitoring,
	UrlMonitorEntitlementError
} from "../services/url-monitoring-provisioning.service";

const sendUrlMonitoringError = (res: Response, error: unknown, fallback: string): void => {
	if (error instanceof UrlMonitorEntitlementError) {
		res.status(422).json({
			error: error.message,
			monitorsRequired: error.monitorsRequired,
			monitorsAvailable: error.monitorsAvailable,
			urlMonitoring: error.urlMonitoring,
			retryable: true
		});
		return;
	}
	res.status(500).json({
		error: fallback,
		detail: error instanceof Error ? error.message : "Unknown monitoring setup error",
		retryable: true
	});
};

const buildMonitoringSummary = (row: any) => {
	const services = row.services ?? row.Service ?? [];
	const connections = row.connections ?? row.Connection ?? [];
	const heartbeats = row.heartbeats ?? row.Heartbeat ?? [];
	const events = row.events ?? row.Event ?? [];
	const urlConnections = connections.filter((connection: any) =>
		connection?.name === "Public website" || connection?.name === "Admin endpoint"
	);
	const checks = services.flatMap((service: any) =>
		(service.Check ?? service.checks ?? []).map((check: any) => ({
			...check,
			serviceId: service.id,
			latestResult: (check.CheckResult ?? check.checkResults ?? [])[0] ?? null
		}))
	);
	const checkFor = (role: "PUBLIC" | "ADMIN", type: "HTTP" | "SSL") =>
		checks.find((check: any) => {
			const config = check.configJson && typeof check.configJson === "object" ? check.configJson : {};
			return config.monitoringRole === role && check.type === type && check.isActive;
		});
	const publicConnection = urlConnections.find((connection: any) => connection.name === "Public website");
	const adminConnection = urlConnections.find((connection: any) => connection.name === "Admin endpoint");
	const publicHttp = checkFor("PUBLIC", "HTTP");
	const publicSsl = checkFor("PUBLIC", "SSL");
	const adminHttp = checkFor("ADMIN", "HTTP");
	const adminSsl = checkFor("ADMIN", "SSL");
	const generatedChecks = [publicHttp, publicSsl, adminHttp, adminSsl].filter(Boolean);
	const failedConnection = urlConnections.find((connection: any) =>
		connection.installationStatus === "ERROR" || connection.health === "DEGRADED"
	);
	const failedCheck = generatedChecks.find((check: any) =>
		check.latestResult && check.latestResult.status !== "PASS"
	);
	const firstResultPending = generatedChecks.length > 0 && generatedChecks.every((check: any) => !check.latestResult);
	const oldestConnectionAt = urlConnections
		.map((connection: any) => connection.createdAt ? new Date(connection.createdAt).getTime() : Date.now())
		.reduce((oldest: number, createdAt: number) => Math.min(oldest, createdAt), Date.now());
	const workerUnavailable = firstResultPending && Date.now() - oldestConnectionAt > 5 * 60_000;
	const active = generatedChecks.some((check: any) => Boolean(check.latestResult));
	const setupStatus = failedConnection || failedCheck || workerUnavailable
		? "FAILED"
		: active
			? "ACTIVE"
			: urlConnections.length > 0
				? "SETTING_UP"
				: "NOT_CONFIGURED";

	return {
		status: setupStatus,
		error:
			failedCheck?.latestResult?.message ??
			failedConnection?.healthReason ??
			(workerUnavailable ? "No check results received; the monitoring worker may be unavailable" : null),
		steps: {
			websiteConnectionCreated: Boolean(publicConnection),
			httpCheckScheduled: Boolean(publicHttp),
			sslCheckScheduled: Boolean(publicSsl),
			firstCheckPending: firstResultPending,
			monitoringActive: active
		},
		depth: {
			externalMonitoring: {
				publicUrlConnected: Boolean(publicConnection),
				httpMonitoringActive: Boolean(publicHttp?.latestResult),
				sslMonitoringActive: Boolean(publicSsl?.latestResult),
				adminUrlMonitoring: adminConnection
					? Boolean(adminHttp?.latestResult || adminSsl?.latestResult)
						? "ACTIVE"
						: "PENDING"
					: "NOT_CONFIGURED"
			},
			applicationMonitoring: {
				heartbeat: heartbeats.length > 0 ? "CONNECTED" : "NOT_CONFIGURED",
				events: events.length > 0 ? "CONNECTED" : "NOT_CONFIGURED"
			},
			advancedMonitoring: {
				logs: "NOT_CONNECTED",
				traces: "NOT_CONNECTED",
				infrastructure: "NOT_CONNECTED"
			}
		}
	};
};

const normalizeProjectRow = (row: any) => {
	const { signingSecret: _signingSecret, apiKey: _apiKey, ...safeRow } = row;
	return {
		...safeRow,
		signingSecretConfigured: Boolean(row.signingSecret?.trim?.() || row.signingCredentialFamilyId),
		signingSecretRotatedAt: row.signingSecretRotatedAt
			? new Date(row.signingSecretRotatedAt).toISOString()
			: null,
		services: row.services ?? row.Service ?? [],
		alerts: row.alerts ?? row.Alert ?? [],
		incidents: row.incidents ?? row.Incident ?? [],
		heartbeats: row.heartbeats ?? row.Heartbeat ?? [],
		events: row.events ?? row.Event ?? [],
		integrations: row.integrations ?? row.ProjectIntegration ?? [],
		notificationChannels: row.notificationChannels ?? row.NotificationChannel ?? [],
		billing: row.billing ?? row.ProjectBilling ?? null,
		connections: (row.connections ?? row.Connection ?? []).map((connection: any) => ({
			id: connection.id,
			name: connection.name,
			health: connection.health,
			healthReason: connection.healthReason,
			installationStatus: connection.installationStatus,
			linkedServiceId: connection.linkedServiceId,
			linkedCheckId: connection.linkedCheckId
		})),
		monitoringSetup: buildMonitoringSummary(row)
	};
};

const loadProjectsForOrg = async (orgId: string) => {
	try {
		return await prisma.project.findMany({
			where: { organizationId: orgId },
			include: projectInclude,
			orderBy: { createdAt: "desc" }
		});
	} catch (error) {
		if (!isPrismaSchemaDriftError(error)) {
			throw error;
		}
		console.error("PROJECT_LIST_SCHEMA_DRIFT", error instanceof Error ? error.message : error);
		return prisma.project.findMany({
			where: { organizationId: orgId },
			include: projectIncludeLite,
			orderBy: { createdAt: "desc" }
		});
	}
};

const loadProjectForResponse = async (projectId: string, orgId: string, fallback: any) => {
	try {
		const row = await prisma.project.findFirst({
			where: { id: projectId, organizationId: orgId },
			include: projectInclude
		});
		if (!row) return normalizeProjectRow(fallback);
		return normalizeProjectRow(await enrichProjectRow(row as any));
	} catch (error) {
		if (!isPrismaSchemaDriftError(error)) {
			throw error;
		}
		console.error("PROJECT_LOAD_SCHEMA_DRIFT", error instanceof Error ? error.message : error);
		try {
			const row = await prisma.project.findFirst({
				where: { id: projectId, organizationId: orgId },
				include: projectIncludeLite
			});
			if (!row) return normalizeProjectRow(fallback);
			return normalizeProjectRow(await enrichProjectRow(row as any));
		} catch (enrichError) {
			console.error("PROJECT_ENRICH_ERROR", enrichError instanceof Error ? enrichError.message : enrichError);
			return normalizeProjectRow(fallback);
		}
	}
};

export const listProjects = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const rows = await loadProjectsForOrg(orgId);
	const enriched = await Promise.all(
		rows.map(async (row) => {
			try {
				return normalizeProjectRow(await enrichProjectRow(row as any));
			} catch (error) {
				console.error("PROJECT_ENRICH_ERROR", {
					projectId: row.id,
					message: error instanceof Error ? error.message : String(error)
				});
				return normalizeProjectRow(row as any);
			}
		})
	);

	res.json(enriched);
};

export const createProject = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	try {
		await assertWithinLimit(orgId, ENTITLEMENT.APPLICATIONS_MAX);
	} catch (error) {
		if (handleEntitlementFailure(res, error)) return;
		throw error;
	}

	const body = req.body ?? {};
	const name = String(body.name || "Untitled Project").trim();
	const slug = String(body.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
	const now = new Date();
	let frontendUrl: string | null = null;
	let adminUrl: string | null = null;
	try {
		frontendUrl = body.frontendUrl ? await normalizeMonitoringUrl(String(body.frontendUrl)) : null;
		adminUrl = body.adminUrl ? await normalizeMonitoringUrl(String(body.adminUrl)) : null;
		if (frontendUrl && adminUrl && frontendUrl === adminUrl) {
			res.status(400).json({ error: "Public and admin URLs must be different" });
			return;
		}
	} catch (error) {
		res.status(400).json({ error: error instanceof Error ? error.message : "Invalid monitoring URL" });
		return;
	}
	const operationalLocationId = body.operationalLocationId ? String(body.operationalLocationId) : null;
	if (operationalLocationId) {
		const location = await prisma.operationalLocation.findFirst({
			where: { id: operationalLocationId, organizationId: orgId },
			select: { id: true }
		});
		if (!location) {
			res.status(400).json({ error: "operationalLocationId is not in your organization" });
			return;
		}
	}

	let row;
	try {
		row = await prisma.project.create({
			data: {
				id: randomUUID(),
				name,
				slug,
				clientName: String(body.clientName || name),
				description: body.description ? String(body.description) : null,
				environment: String(body.environment || "production"),
				frontendUrl,
				adminUrl,
				backendUrl: body.backendUrl ? String(body.backendUrl) : null,
				repoUrl: body.repoUrl ? String(body.repoUrl) : null,
				projectOwner: body.projectOwner ? String(body.projectOwner) : null,
				operationalContact: body.operationalContact ? String(body.operationalContact) : null,
				defaultRegion: body.defaultRegion ? String(body.defaultRegion) : null,
				status: "UNKNOWN",
				healthReason: "Waiting for first heartbeat",
				healthSource: "project-create",
				monitoringEnabled: body.monitoringEnabled !== false,
				monitoringStartedAt: body.monitoringEnabled === false ? null : now,
				automationMode: typeof body.automationMode === "string" ? body.automationMode : "MONITOR_ONLY",
				operationalLocationId,
				apiKey: generateApiKey(),
				signingSecret: generateSigningSecret(),
				updatedAt: now,
				organizationId: orgId
			}
		});
	} catch (error) {
		if (isPrismaUniqueViolation(error, "slug")) {
			res.status(409).json({ error: "A project with this slug already exists" });
			return;
		}
		throw error;
	}

	try {
		if (frontendUrl || adminUrl) {
			await reconcileProjectUrlMonitoring({
				organizationId: orgId,
				projectId: row.id,
				projectName: row.name,
				environment: row.environment,
				...(frontendUrl ? { publicUrl: frontendUrl } : {}),
				...(adminUrl ? { adminUrl } : {}),
				createdBy: req.user?.id ?? req.user?.sub ?? null
			});
		}
	} catch (error) {
		await prisma.project.delete({ where: { id: row.id } }).catch(() => undefined);
		sendUrlMonitoringError(res, error, "Monitoring setup failed; registration was rolled back and can be retried");
		return;
	}

	try {
		await provisionProjectSigningSecret({
			organizationId: orgId,
			projectId: row.id,
			signingSecret: row.signingSecret,
			environment: row.environment,
			actorUserId: req.user?.id ?? req.user?.sub ?? null
		});
	} catch (error) {
		console.error("PROJECT_SIGNING_PROVISION_ERROR", error instanceof Error ? error.message : error);
	}

	let ingestCredentials: ProvisionedIngestCredentials | { error: string };
	try {
		ingestCredentials = await provisionProjectIngestCredentials({
			organizationId: orgId,
			projectId: row.id,
			projectName: row.name,
			projectSlug: row.slug,
			signingSecret: row.signingSecret,
			environment:
				row.environment === "development" || row.environment === "staging" || row.environment === "testing"
					? "test"
					: "live"
		});
	} catch (error) {
		console.error("INGEST_KEY_PROVISION_ERROR", error instanceof Error ? error.message : error);
		ingestCredentials = {
			error:
				isPrismaSchemaDriftError(error)
					? "Database migrations are incomplete. Run prisma migrate deploy, then retry."
					: error instanceof Error
						? error.message
						: "Failed to provision ingest API key"
		};
	}

	try {
		await createDefaultProjectBilling(row.id, "FREE");
	} catch (error) {
		console.error("PROJECT_BILLING_CREATE_ERROR", error instanceof Error ? error.message : error);
	}

	if (hasPermission(req.user?.role, "policy:manage") && (body.billing || body.plan)) {
		try {
			const billingBody = body.billing ?? {};
			await updateProjectBilling({
				projectId: row.id,
				plan: billingBody.plan ?? body.plan,
				monthlyPrice: typeof billingBody.monthlyPrice === "number" ? billingBody.monthlyPrice : undefined,
				currency: typeof billingBody.currency === "string" ? billingBody.currency : undefined,
				billingStatus: billingBody.billingStatus,
				checkLimit: typeof billingBody.checkLimit === "number" || billingBody.checkLimit === null ? billingBody.checkLimit : undefined,
				userLimit: typeof billingBody.userLimit === "number" || billingBody.userLimit === null ? billingBody.userLimit : undefined,
				automationRunLimit:
					typeof billingBody.automationRunLimit === "number" || billingBody.automationRunLimit === null
						? billingBody.automationRunLimit
						: undefined,
				internalNotes: typeof billingBody.internalNotes === "string" ? billingBody.internalNotes : undefined,
				updatedById: typeof req.user?.sub === "string" ? req.user.sub : undefined
			});
		} catch (error) {
			console.error("PROJECT_BILLING_UPDATE_ERROR", error instanceof Error ? error.message : error);
		}
	}

	const normalized = await loadProjectForResponse(row.id, orgId, row);
	res.status(201).json({
		...normalized,
		ingestCredentials
	});
};

export const getProjectById = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const row = await prisma.project.findFirst({
		where: { id: req.params.projectId, organizationId: orgId },
		include: {
			...projectInclude,
			Alert: { orderBy: { lastSeenAt: "desc" }, take: 100 },
			Incident: { orderBy: { openedAt: "desc" }, take: 50 },
			Heartbeat: { orderBy: { receivedAt: "desc" }, take: 50 },
			Event: { orderBy: { createdAt: "desc" }, take: 100 },
			ProjectIntegration: true,
			NotificationChannel: true
		}
	});

	if (!row) {
		res.status(404).json({ error: "Project not found" });
		return;
	}
	res.json(normalizeProjectRow(await enrichProjectRow(row as any)));
};

export const patchProject = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const existing = await prisma.project.findFirst({
		where: { id: req.params.projectId, organizationId: orgId },
		select: { id: true }
	});

	if (!existing) {
		res.status(404).json({ error: "Project not found" });
		return;
	}

	const body = req.body ?? {};
	let frontendUrl: string | null | undefined;
	let adminUrl: string | null | undefined;
	try {
		frontendUrl =
			body.frontendUrl === undefined
				? undefined
				: body.frontendUrl
					? await normalizeMonitoringUrl(String(body.frontendUrl))
					: null;
		adminUrl =
			body.adminUrl === undefined
				? undefined
				: body.adminUrl
					? await normalizeMonitoringUrl(String(body.adminUrl))
					: null;
		const nextFrontendUrl = frontendUrl === undefined ? undefined : frontendUrl;
		const nextAdminUrl = adminUrl === undefined ? undefined : adminUrl;
		if (nextFrontendUrl && nextAdminUrl && nextFrontendUrl === nextAdminUrl) {
			res.status(400).json({ error: "Public and admin URLs must be different" });
			return;
		}
	} catch (error) {
		res.status(400).json({ error: error instanceof Error ? error.message : "Invalid monitoring URL" });
		return;
	}
	if (body.operationalLocationId !== undefined && body.operationalLocationId !== null) {
		const location = await prisma.operationalLocation.findFirst({
			where: { id: String(body.operationalLocationId), organizationId: orgId },
			select: { id: true }
		});
		if (!location) {
			res.status(400).json({ error: "operationalLocationId is not in your organization" });
			return;
		}
	}
	let row = await prisma.project.update({
		where: { id: req.params.projectId },
		data: {
			...(body.name !== undefined ? { name: String(body.name) } : {}),
			...(body.slug !== undefined ? { slug: String(body.slug) } : {}),
			...(body.clientName !== undefined ? { clientName: String(body.clientName) } : {}),
			...(body.description !== undefined ? { description: body.description ? String(body.description) : null } : {}),
			...(body.environment !== undefined ? { environment: String(body.environment) } : {}),
			...(body.backendUrl !== undefined ? { backendUrl: body.backendUrl ? String(body.backendUrl) : null } : {}),
			...(body.repoUrl !== undefined ? { repoUrl: body.repoUrl ? String(body.repoUrl) : null } : {}),
			...(body.projectOwner !== undefined ? { projectOwner: body.projectOwner ? String(body.projectOwner) : null } : {}),
			...(body.operationalContact !== undefined
				? { operationalContact: body.operationalContact ? String(body.operationalContact) : null }
				: {}),
			...(body.operationalLocationId !== undefined
				? { operationalLocationId: body.operationalLocationId ? String(body.operationalLocationId) : null }
				: {}),
			...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
			updatedAt: new Date()
		}
	});

	try {
		if (frontendUrl !== undefined || adminUrl !== undefined) {
			await reconcileProjectUrlMonitoring({
				organizationId: orgId,
				projectId: row.id,
				projectName: row.name,
				environment: row.environment,
				publicUrl: frontendUrl,
				adminUrl,
				createdBy: req.user?.id ?? req.user?.sub ?? null
			});
			row = await prisma.project.findUniqueOrThrow({
				where: { id: row.id }
			});
		}
	} catch (error) {
		sendUrlMonitoringError(res, error, "Application saved but monitoring setup failed");
		return;
	}

	let ingestCredentials: ProvisionedIngestCredentials | { error: string } | undefined;
	try {
		ingestCredentials = await provisionProjectIngestCredentials({
			organizationId: orgId,
			projectId: row.id,
			projectName: row.name,
			projectSlug: row.slug,
			signingSecret: row.signingSecret,
			environment:
				row.environment === "development" || row.environment === "staging" || row.environment === "testing"
					? "test"
					: "live"
		});
	} catch (error) {
		console.error("INGEST_KEY_PROVISION_ERROR", error instanceof Error ? error.message : error);
		ingestCredentials = {
			error: error instanceof Error ? error.message : "Failed to provision ingest API key"
		};
	}

	res.json({
		...normalizeProjectRow(row),
		...(ingestCredentials ? { ingestCredentials } : {})
	});
};

export const deleteProject = async (req: AuthRequest, res: Response) => {
	const orgId = requireOrg(req, res);
	if (!orgId) return;

	const result = await prisma.project.deleteMany({
		where: { id: req.params.projectId, organizationId: orgId }
	});

	if (result.count === 0) {
		res.status(404).json({ error: "Project not found" });
		return;
	}
	res.status(204).send();
};
