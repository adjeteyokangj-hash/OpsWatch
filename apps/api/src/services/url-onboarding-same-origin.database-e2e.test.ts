import { randomUUID } from "crypto";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env" });
const enabled = process.env.RUN_DATABASE_E2E === "true";

// Regression: an application whose public and admin URLs share the same origin
// (e.g. https://truenumeris.com + https://truenumeris.com/admin) must register.
// Previously the second (admin) monitoring role collided with the public role on
// the OperationalEntityIdentity unique key (source + sourceKey were derived from
// the origin only), throwing GraphIdentityConflictError and rolling the project back.
describe.runIf(enabled)("URL onboarding with a shared origin (TrueNumeris)", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let createProject: typeof import("../controllers/projects.controller").createProject;
  const organizationId = randomUUID();
  let projectId = "";

  beforeAll(async () => {
    ({ prisma } = await import("../lib/prisma"));
    ({ createProject } = await import("../controllers/projects.controller"));
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "TEST ONLY — TrueNumeris same-origin onboarding",
        slug: `test-same-origin-${organizationId}`,
        updatedAt: new Date()
      }
    });
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  }, 60_000);

  it("registers TrueNumeris with public and admin URLs on the same domain", async () => {
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
        name: "TrueNumeris",
        // Unique slug so the regression is isolated from any manually-created
        // "truenumeris" project in the local database (slug is globally unique).
        slug: `truenumeris-${organizationId.slice(0, 8)}`,
        environment: "production",
        frontendUrl: "https://truenumeris.com",
        adminUrl: "https://truenumeris.com/admin",
        monitoringEnabled: true
      },
      user: {
        id: "test-same-origin-user",
        sub: "test-same-origin-user",
        role: "ORG_ADMIN",
        organizationId
      }
    };

    await createProject(request as any, response as any);

    // Registration must complete — not roll back.
    expect(statusCode).toBe(201);
    projectId = responseBody.id;
    expect(projectId).toBeTruthy();

    // The application row must still exist (no rollback).
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    expect(project).not.toBeNull();

    // Both monitoring roles must be provisioned.
    const connections = await prisma.connection.findMany({
      where: { projectId },
      orderBy: { name: "asc" }
    });
    expect(connections.map((row) => row.name)).toEqual(["Admin endpoint", "Public website"]);

    const checks = await prisma.check.findMany({ where: { Service: { projectId } } });
    expect(checks.filter((row) => row.type === "HTTP")).toHaveLength(2);
    expect(checks.filter((row) => row.type === "SSL")).toHaveLength(2);

    // The canonical graph must hold two distinct entities and two distinct
    // source identities for the same origin — one per role.
    const entities = await prisma.operationalEntity.findMany({
      where: { projectId, discoverySource: "URL_ONBOARDING" }
    });
    expect(entities).toHaveLength(2);
    expect(new Set(entities.map((row) => row.entityType))).toEqual(
      new Set(["WEBSITE", "ADMIN_PORTAL"])
    );

    const identities = await prisma.operationalEntityIdentity.findMany({
      where: { projectId, source: "URL_ONBOARDING" }
    });
    expect(identities).toHaveLength(2);
    expect(new Set(identities.map((row) => row.sourceKey))).toEqual(
      new Set(["public:https://truenumeris.com", "admin:https://truenumeris.com"])
    );
  }, 120_000);
});
