import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { decideModule, listModuleDefinitions } from "./module-assignment.service";
import { discoverProjectModules } from "./module-discovery.service";

describe.runIf(process.env.RUN_DATABASE_E2E === "true")("persistent module catalogue tenant boundaries", () => {
  const org = randomUUID(), otherOrg = randomUUID(), project = randomUUID(), otherProject = randomUUID(), otherEntity = randomUUID();
  beforeAll(async () => {
    for (const id of [org, otherOrg]) await prisma.organization.create({ data: { id, name: id, slug: id, updatedAt: new Date() } });
    await prisma.project.create({ data: { id: project, name: "Oware World", slug: project, clientName: "Test", organizationId: org,
      environment: "test", description: "Oware gameplay and two-player game engine", apiKey: randomUUID(), signingSecret: randomUUID(), updatedAt: new Date() } });
    await prisma.project.create({ data: { id: otherProject, name: "Other tenant", slug: otherProject, clientName: "Test", organizationId: otherOrg,
      environment: "test", apiKey: randomUUID(), signingSecret: randomUUID(), updatedAt: new Date() } });
    await prisma.operationalEntity.create({ data: { id: otherEntity, organizationId: otherOrg, projectId: otherProject,
      name: "Other private component", entityType: "MODULE", updatedAt: new Date() } });
  });
  afterAll(async () => {
    await prisma.projectModuleAssignment.deleteMany({ where: { organizationId: org } });
    await prisma.moduleDiscoveryRun.deleteMany({ where: { organizationId: org } });
    await prisma.moduleCatalogueDefinition.deleteMany({ where: { organizationId: org } });
    await prisma.auditLog.deleteMany({ where: { organizationId: org } });
    await prisma.operationalEntity.deleteMany({ where: { id: otherEntity } });
    await prisma.project.deleteMany({ where: { id: { in: [project, otherProject] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [org, otherOrg] } } });
  });
  it("persists proposals, preserves owner rejection and never creates topology", async () => {
    const before = await prisma.operationalEntity.count({ where: { projectId: project } });
    await discoverProjectModules({ organizationId: org, projectId: project, inspectWebsite: false, useAi: false });
    const proposed = await prisma.projectModuleAssignment.findMany({ where: { organizationId: org, projectId: project } });
    expect(proposed.map(row => row.moduleKey)).toEqual(["games"]);
    expect(proposed[0].state).toBe("PROPOSED");
    await decideModule({ organizationId: org, projectId: project, moduleKey: "games", state: "REJECTED" });
    // A new test slot represents a later reanalysis without sleeping.
    await prisma.moduleDiscoveryRun.updateMany({ where: { projectId: project }, data: { slot: 0 } });
    await discoverProjectModules({ organizationId: org, projectId: project, inspectWebsite: false, useAi: false });
    expect(await prisma.projectModuleAssignment.count({ where: { projectId: project, moduleKey: "games", state: "REJECTED" } })).toBe(1);
    expect(await prisma.operationalEntity.count({ where: { projectId: project } })).toBe(before);
    expect(await prisma.service.count({ where: { projectId: project } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: org, action: "MODULE_REJECTED" } })).toBe(1);
  });
  it("database rejects cross-tenant assignments and custom catalogue cannot leak", async () => {
    await expect(prisma.projectModuleAssignment.create({ data: { organizationId: otherOrg, projectId: project,
      moduleKey: "payments", source: "OWNER", confidence: 1, evidenceJson: [] } })).rejects.toThrow();
    await prisma.moduleCatalogueDefinition.create({ data: { organizationId: org, key: "private_module", label: "Private Module",
      description: "Only this organisation", category: "CUSTOM", terms: ["private"], capabilities: [] } });
    expect((await listModuleDefinitions(otherOrg)).map(row => row.key)).not.toContain("private_module");
  });
  it("rejects stale review and rate bounds repeated analysis", async () => {
    await expect(decideModule({ organizationId: org, projectId: project, moduleKey: "games", state: "APPROVED",
      expectedUpdatedAt: "2000-01-01T00:00:00.000Z" })).rejects.toThrow("ASSIGNMENT_CONFLICT");
    await expect(discoverProjectModules({ organizationId: org, projectId: project, inspectWebsite: false, useAi: false })).rejects.toThrow();
  });
  it("database rejects cross-tenant component bindings", async () => {
    await expect(prisma.projectModuleAssignment.updateMany({ where: { organizationId: org, projectId: project, moduleKey: "games" },
      data: { verifiedEntityId: otherEntity } })).rejects.toThrow();
  });
});
