import { randomUUID } from "crypto";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

config({ path: ".env" });
const enabled = process.env.RUN_DATABASE_E2E === "true";

describe.runIf(enabled)("URL-only onboarding registration to worker", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let createProject: typeof import("../controllers/projects.controller").createProject;
  let getProjectById: typeof import("../controllers/projects.controller").getProjectById;
  let patchProject: typeof import("../controllers/projects.controller").patchProject;
  let runHttpChecksJob: typeof import("../../../worker/src/jobs/run-http-checks.job").runHttpChecksJob;
  let runSslChecksJob: typeof import("../../../worker/src/jobs/run-ssl-checks.job").runSslChecksJob;
  let enrichProjectRow: typeof import("./project-loader.service").enrichProjectRow;
  let reconcileProjectUrlMonitoring:
    typeof import("./url-monitoring-provisioning.service").reconcileProjectUrlMonitoring;
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const otherProjectId = randomUUID();
  let projectId = "";
  const concurrentProjectId = randomUUID();

  beforeAll(async () => {
    ({ prisma } = await import("../lib/prisma"));
    ({ createProject, getProjectById, patchProject } = await import("../controllers/projects.controller"));
    ({ enrichProjectRow } = await import("./project-loader.service"));
    ({ reconcileProjectUrlMonitoring } = await import("./url-monitoring-provisioning.service"));
    ({ runHttpChecksJob } = await import("../../../worker/src/jobs/run-http-checks.job"));
    ({ runSslChecksJob } = await import("../../../worker/src/jobs/run-ssl-checks.job"));
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "TEST ONLY — URL onboarding E2E",
        slug: `test-url-onboarding-${organizationId}`,
        updatedAt: new Date()
      }
    });
    await prisma.organization.create({
      data: {
        id: otherOrganizationId,
        name: "TEST ONLY — URL onboarding other org",
        slug: `test-url-onboarding-other-${otherOrganizationId}`,
        updatedAt: new Date()
      }
    });
    await prisma.project.create({
      data: {
        id: otherProjectId,
        name: "TEST ONLY — isolated application",
        slug: `test-url-isolated-${otherProjectId}`,
        clientName: "TEST ONLY",
        environment: "testing",
        apiKey: randomUUID(),
        signingSecret: randomUUID(),
        organizationId: otherOrganizationId,
        updatedAt: new Date()
      }
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (!prisma) return;
    if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.project.deleteMany({ where: { id: concurrentProjectId } });
    await prisma.project.deleteMany({ where: { id: otherProjectId } });
    await prisma.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
    await prisma.$disconnect();
  });

  it("persists, executes, alerts, recovers, and remains heartbeat-independent", async () => {
    let statusCode = 200;
    let responseBody: any;
    const response = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: unknown) {
        responseBody = body;
        return this;
      }
    };
    const request = {
      body: {
        name: `TEST ONLY URL onboarding ${organizationId.slice(0, 8)}`,
        clientName: "TEST ONLY",
        environment: "testing",
        frontendUrl: "https://example.com/",
        adminUrl: "https://example.org/",
        monitoringEnabled: true,
        automationMode: "MONITOR_ONLY"
      },
      user: {
        id: "test-url-onboarding-user",
        sub: "test-url-onboarding-user",
        role: "ORG_ADMIN",
        organizationId
      }
    };

    await createProject(request as any, response as any);
    expect(statusCode).toBe(201);
    projectId = responseBody.id;
    expect(projectId).toBeTruthy();
    expect(responseBody.ingestCredentials.apiKey).toMatch(/^ow_/);
    expect(responseBody.ingestCredentials.signingSecret).toBeTruthy();
    expect(responseBody.heartbeats).toEqual([]);

    const connections = await prisma.connection.findMany({
      where: { projectId },
      orderBy: { name: "asc" }
    });
    expect(connections).toHaveLength(2);
    expect(connections.map((row) => row.name)).toEqual(["Admin endpoint", "Public website"]);
    expect(connections.every((row) =>
      !row.managedSecretCiphertext &&
      !row.managedSecretIv &&
      !row.managedSecretAuthTag &&
      !row.secretRef
    )).toBe(true);

    const checks = await prisma.check.findMany({
      where: { Service: { projectId } },
      orderBy: [{ type: "asc" }, { name: "asc" }]
    });
    expect(checks).toHaveLength(4);
    expect(checks.filter((row) => row.type === "HTTP")).toHaveLength(2);
    expect(checks.filter((row) => row.type === "SSL")).toHaveLength(2);
    expect(checks.every((row) => row.isActive)).toBe(true);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await runHttpChecksJob({ projectId });
    await runSslChecksJob({ projectId });

    const firstResults = await prisma.checkResult.findMany({
      where: { Check: { Service: { projectId } } }
    });
    expect(firstResults).toHaveLength(4);
    expect(firstResults.every((row) => row.status === "PASS")).toBe(true);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await runHttpChecksJob({ projectId });
    await runHttpChecksJob({ projectId });
    await runHttpChecksJob({ projectId });

    const failedAlerts = await prisma.alert.findMany({
      where: {
        projectId,
        sourceType: "CHECK",
        status: "OPEN"
      }
    });
    expect(failedAlerts.length).toBeGreaterThanOrEqual(2);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await runHttpChecksJob({ projectId });
    await runHttpChecksJob({ projectId });

    expect(await prisma.alert.count({
      where: { projectId, sourceType: "CHECK", status: "OPEN" }
    })).toBe(0);
    expect(await prisma.alert.count({
      where: { projectId, sourceType: "CHECK", status: "RESOLVED" }
    })).toBeGreaterThanOrEqual(2);

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        Service: { include: { Check: true } },
        Alert: { where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } },
        Incident: { where: { status: { in: ["OPEN", "INVESTIGATING", "MONITORING"] } } },
        Heartbeat: { orderBy: { receivedAt: "desc" }, take: 1 },
        ProjectBilling: true,
        Connection: { where: { isActive: true } },
        NotificationChannel: { where: { isActive: true } }
      }
    });
    const enriched = await enrichProjectRow(project as any);
    expect(enriched.status).toBe("HEALTHY");
    expect(enriched.healthReason).toMatch(/Public website.*passed/i);
    expect(enriched.lastCompletedCheckAt).toBeTruthy();
    expect(enriched.Heartbeat).toHaveLength(0);

    const safeProject = JSON.stringify(responseBody);
    expect(safeProject).not.toContain("managedSecretCiphertext");
    expect(safeProject).not.toContain("secretRef");
  }, 120_000);

  it("keeps URL monitoring organization-scoped and hides stored project secrets", async () => {
    const makeResponse = () => {
      let statusCode = 200;
      let body: any;
      return {
        response: {
          status(code: number) {
            statusCode = code;
            return this;
          },
          json(value: unknown) {
            body = value;
            return this;
          }
        },
        result: () => ({ statusCode, body })
      };
    };

    const isolatedPatch = makeResponse();
    await patchProject({
      params: { projectId: otherProjectId },
      body: { frontendUrl: "https://example.com/" },
      user: { organizationId, id: "test-user", role: "ORG_ADMIN" }
    } as any, isolatedPatch.response as any);
    expect(isolatedPatch.result().statusCode).toBe(404);
    expect(await prisma.connection.count({ where: { projectId: otherProjectId } })).toBe(0);

    const safeGet = makeResponse();
    await getProjectById({
      params: { projectId },
      user: { organizationId, id: "test-user", role: "ORG_ADMIN" }
    } as any, safeGet.response as any);
    expect(safeGet.result().statusCode).toBe(200);
    const serialized = JSON.stringify(safeGet.result().body);
    expect(serialized).not.toContain("\"apiKey\"");
    expect(serialized).not.toContain("\"signingSecret\"");
    expect(serialized).not.toContain("managedSecretCiphertext");
    expect(safeGet.result().body.monitoringSetup.depth.applicationMonitoring.heartbeat).toBe("NOT_CONFIGURED");
    expect(safeGet.result().body.healthReason).toMatch(/Public website.*passed/i);
  });

  it("serializes concurrent duplicate provisioning without consuming extra monitors", async () => {
    await prisma.project.create({
      data: {
        id: concurrentProjectId,
        name: "TEST ONLY — concurrent URL provisioning",
        slug: `test-url-concurrent-${concurrentProjectId}`,
        clientName: "TEST ONLY",
        environment: "testing",
        apiKey: randomUUID(),
        signingSecret: randomUUID(),
        organizationId,
        updatedAt: new Date()
      }
    });
    const input = {
      organizationId,
      projectId: concurrentProjectId,
      projectName: "TEST ONLY — concurrent URL provisioning",
      environment: "testing",
      publicUrl: "https://example.net/"
    };

    await Promise.all([
      reconcileProjectUrlMonitoring(input),
      reconcileProjectUrlMonitoring(input)
    ]);

    expect(await prisma.connection.count({
      where: { projectId: concurrentProjectId, isActive: true }
    })).toBe(1);
    expect(await prisma.check.count({
      where: { Service: { projectId: concurrentProjectId }, isActive: true }
    })).toBe(2);
  }, 30_000);
});
