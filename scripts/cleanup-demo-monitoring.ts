import { randomUUID } from "crypto";
import { PrismaClient, ProjectStatus } from "@prisma/client";

const prisma = new PrismaClient();

const projectSlug = process.env.DEMO_PROJECT_SLUG || "sparkle";
const publicSiteUrl = process.env.SPARKLE_PUBLIC_URL || "https://sparkle-valeting.vercel.app/";
const verificationCheckNames = [
	"Verification HTTP Failure/Recovery",
	"Verification SSL Check",
	"Notification Verification Check"
];
const publicHttpAliases = ["Public site HTTP", "Public site HTTP 200", "https://sparkle-valeting.vercel.app/"];
const publicSslAliases = ["Public SSL expiry", "https://sparkle-valeting.vercel.app/about"];

const unique = <T,>(values: T[]): T[] => Array.from(new Set(values));

const main = async (): Promise<void> => {
	const project = await prisma.project.findUnique({
		where: { slug: projectSlug },
		include: {
			Service: { include: { Check: true } },
			Alert: true,
			Event: true,
			Heartbeat: { orderBy: { receivedAt: "desc" }, take: 5 }
		}
	});

	if (!project) {
		throw new Error(`Project '${projectSlug}' not found`);
	}

	const verificationService = project.Service.find((service) => service.name === "OpsWatch Verification Service") || null;
	let publicService = project.Service.find((service) => service.name === "Public site") || null;

	await prisma.$transaction(async (tx) => {
		await tx.project.update({
			where: { id: project.id },
			data: {
				frontendUrl: publicSiteUrl,
				status: ProjectStatus.HEALTHY,
				updatedAt: new Date(),
			}
		});

		if (publicService) {
			publicService = await tx.service.update({
				where: { id: publicService.id },
				data: {
					baseUrl: publicSiteUrl,
					status: ProjectStatus.HEALTHY,
					isCritical: true,
				}
			});
		} else {
			publicService = await tx.service.create({
				data: {
					id: randomUUID(),
					projectId: project.id,
					name: "Public site",
					type: "FRONTEND",
					status: ProjectStatus.HEALTHY,
					baseUrl: publicSiteUrl,
					isCritical: true,
					updatedAt: new Date(),
				}
			});
		}

		const verificationChecks = project.Service.flatMap((service) => service.Check)
			.filter((check) => verificationCheckNames.includes(check.name));
		const verificationCheckIds = verificationChecks.map((check) => check.id);

		if (verificationCheckIds.length > 0) {
			await tx.alert.deleteMany({
				where: {
					OR: [
						{ sourceId: { in: verificationCheckIds } },
						{ title: { in: verificationCheckNames.map((name) => `${name} failing`) } },
						{ title: { in: verificationCheckNames.map((name) => `${name} SSL expiry warning`) } }
					]
				}
			});
			await tx.checkResult.deleteMany({ where: { checkId: { in: verificationCheckIds } } });
			await tx.check.deleteMany({ where: { id: { in: verificationCheckIds } } });
		}

		if (verificationService) {
			await tx.alert.deleteMany({ where: { serviceId: verificationService.id } });
			await tx.service.delete({ where: { id: verificationService.id } });
		}

		const publicHttpChecks = await tx.check.findMany({
			where: { Service: { projectId: project.id }, name: { in: publicHttpAliases } },
			orderBy: { createdAt: "asc" }
		});
		const primaryPublicHttp = publicHttpChecks[0]
			? await tx.check.update({
				where: { id: publicHttpChecks[0].id },
				data: {
					serviceId: publicService.id,
					name: "Public site HTTP",
					type: "HTTP",
					expectedStatusCode: 200,
					isActive: true,
					updatedAt: new Date(),
				}
			})
			: await tx.check.create({
				data: {
					id: randomUUID(),
					serviceId: publicService.id,
					name: "Public site HTTP",
					type: "HTTP",
					intervalSeconds: 300,
					timeoutMs: 5000,
					expectedStatusCode: 200,
					failureThreshold: 1,
					recoveryThreshold: 1,
					isActive: true,
					updatedAt: new Date(),
				}
			});

		const duplicatePublicHttpIds = publicHttpChecks.slice(1).map((check) => check.id);
		if (duplicatePublicHttpIds.length > 0) {
			await tx.alert.deleteMany({ where: { sourceId: { in: duplicatePublicHttpIds } } });
			await tx.checkResult.deleteMany({ where: { checkId: { in: duplicatePublicHttpIds } } });
			await tx.check.deleteMany({ where: { id: { in: duplicatePublicHttpIds } } });
		}

		const publicSslChecks = await tx.check.findMany({
			where: { Service: { projectId: project.id }, name: { in: publicSslAliases } },
			orderBy: { createdAt: "asc" }
		});
		const primaryPublicSsl = publicSslChecks[0]
			? await tx.check.update({
				where: { id: publicSslChecks[0].id },
				data: {
					serviceId: publicService.id,
					name: "Public SSL expiry",
					type: "SSL",
					intervalSeconds: 86400,
					timeoutMs: 5000,
					isActive: true,
					updatedAt: new Date(),
				}
			})
			: await tx.check.create({
				data: {
					id: randomUUID(),
					serviceId: publicService.id,
					name: "Public SSL expiry",
					type: "SSL",
					intervalSeconds: 86400,
					timeoutMs: 5000,
					failureThreshold: 1,
					recoveryThreshold: 1,
					isActive: true,
					updatedAt: new Date(),
				}
			});

		const duplicatePublicSslIds = publicSslChecks.slice(1).map((check) => check.id);
		if (duplicatePublicSslIds.length > 0) {
			await tx.alert.deleteMany({ where: { sourceId: { in: duplicatePublicSslIds } } });
			await tx.checkResult.deleteMany({ where: { checkId: { in: duplicatePublicSslIds } } });
			await tx.check.deleteMany({ where: { id: { in: duplicatePublicSslIds } } });
		}

		await tx.checkResult.deleteMany({
			where: { checkId: { in: [primaryPublicHttp.id, primaryPublicSsl.id] } }
		});

		await tx.alert.deleteMany({
			where: {
				OR: [
					{ sourceId: primaryPublicHttp.id, title: "Public site HTTP 200 failing" },
					{ sourceId: primaryPublicSsl.id },
					{ message: { contains: "SSL checks require https:// URLs" } },
					{ message: { contains: "Sparkle payment failure integration test" } },
					{ title: "PAYMENT_FAILED", message: { contains: "integration test" } },
					{ title: "Heartbeat stale", message: { contains: `No heartbeat from ${project.slug}` } }
				]
			}
		});

		await tx.event.deleteMany({
			where: {
				projectId: project.id,
				OR: [
					{ message: { contains: "integration test" } },
					{ source: "local-smoke" }
				]
			}
		});

		await tx.heartbeat.create({
			data: {
				id: randomUUID(),
				projectId: project.id,
				environment: "demo-cleanup",
				status: ProjectStatus.HEALTHY,
				message: "Monitoring seed cleanup heartbeat",
				payloadJson: { source: "cleanup-demo-monitoring" },
				receivedAt: new Date(),
			}
		});
	});

	const refreshed = await prisma.project.findUnique({
		where: { id: project.id },
		include: {
			Service: { include: { Check: true } },
			Alert: { where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } }, orderBy: { lastSeenAt: "desc" } },
			Heartbeat: { orderBy: { receivedAt: "desc" }, take: 1 }
		}
	});

	console.log(JSON.stringify({
		project: refreshed?.slug,
		frontendUrl: refreshed?.frontendUrl,
		services: refreshed?.Service.map((service) => ({
			name: service.name,
			type: service.type,
			baseUrl: service.baseUrl,
			checks: service.Check.map((check) => ({ name: check.name, type: check.type, isActive: check.isActive }))
		})),
		openAlerts: refreshed?.Alert.map((alert) => ({ title: alert.title, message: alert.message, severity: alert.severity })),
		latestHeartbeatAt: refreshed?.Heartbeat[0]?.receivedAt ?? null
	}, null, 2));
};

void main()
	.catch((error) => {
		console.error("CLEANUP_DEMO_MONITORING_FAILED", error);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});