import { randomUUID } from "crypto";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: "../api/.env" });
describe.runIf(process.env.RUN_DATABASE_E2E === "true")("database-backed SLO evaluation", () => {
  let prisma: import("@prisma/client").PrismaClient; let evaluate: () => Promise<void>;
  const org = randomUUID(); const otherOrg = randomUUID(); const project = randomUUID(); const otherProject = randomUUID();
  const service = randomUUID(); const otherService = randomUUID(); const check = randomUUID(); const otherCheck = randomUUID();
  const slo = randomUUID(); const disabledSlo = randomUUID(); const otherSlo = randomUUID();
  beforeAll(async () => {
    ({ prisma } = await import("../lib/prisma")); ({ evaluateSloBurnRateJob: evaluate } = await import("./evaluate-slo-burn-rate.job"));
    await prisma.organization.createMany({ data: [{ id: org, name: "SLO E2E", slug: `slo-${org}`, updatedAt: new Date() }, { id: otherOrg, name: "Other SLO", slug: `slo-${otherOrg}`, updatedAt: new Date() }] });
    await prisma.project.createMany({ data: [
      { id: project, name: "SLO project", slug: `slo-${project}`, clientName: "E2E", environment: "test", apiKey: randomUUID(), signingSecret: randomUUID(), organizationId: org, updatedAt: new Date() },
      { id: otherProject, name: "Other SLO", slug: `slo-${otherProject}`, clientName: "E2E", environment: "test", apiKey: randomUUID(), signingSecret: randomUUID(), organizationId: otherOrg, updatedAt: new Date() }
    ] });
    await prisma.service.createMany({ data: [{ id: service, projectId: project, name: "API", type: "API", updatedAt: new Date() }, { id: otherService, projectId: otherProject, name: "Other API", type: "API", updatedAt: new Date() }] });
    await prisma.check.createMany({ data: [
      { id: check, serviceId: service, name: "API check", type: "HTTP", intervalSeconds: 60, timeoutMs: 1000, updatedAt: new Date() },
      { id: otherCheck, serviceId: otherService, name: "Other check", type: "HTTP", intervalSeconds: 60, timeoutMs: 1000, updatedAt: new Date() }
    ] });
    await prisma.sLODefinition.createMany({ data: [
      { id: slo, projectId: project, serviceId: service, name: "API availability", sliType: "AVAILABILITY", targetPct: 99, windowDays: 30, updatedAt: new Date() },
      { id: disabledSlo, projectId: project, serviceId: service, name: "Disabled", sliType: "AVAILABILITY", targetPct: 99, windowDays: 30, enabled: false, updatedAt: new Date() },
      { id: otherSlo, projectId: otherProject, serviceId: otherService, name: "Other availability", sliType: "AVAILABILITY", targetPct: 99, windowDays: 30, updatedAt: new Date() }
    ] });
    const failed = new Set([0, 1]);
    await prisma.checkResult.createMany({ data: [
      ...Array.from({ length: 100 }, (_, index) => ({ id: randomUUID(), checkId: check, status: failed.has(index) ? "FAIL" as const : "PASS" as const, responseTimeMs: 100, checkedAt: new Date(Date.now() - index * 1000) })),
      ...Array.from({ length: 100 }, (_, index) => ({ id: randomUUID(), checkId: otherCheck, status: "PASS" as const, responseTimeMs: 100, checkedAt: new Date(Date.now() - index * 1000) }))
    ] });
  });
  afterAll(async () => {
    if (!prisma) return; await prisma.project.deleteMany({ where: { id: { in: [project, otherProject] } } }); await prisma.organization.deleteMany({ where: { id: { in: [org, otherOrg] } } }); await prisma.$disconnect();
  });
  it("persists short/long burn rates, alerts once, skips disabled definitions, and isolates tenant data", async () => {
    await evaluate();
    const windows = await prisma.sLOWindow.findMany({ where: { sloDefinitionId: slo } });
    expect(windows).toHaveLength(2); expect(windows.map(row => row.windowMinutes).sort((a,b) => a-b)).toEqual([60, 43200]);
    expect(windows.every(row => row.availabilityPct === 98 && row.burnRate === 2 && row.status === "BREACHING")).toBe(true);
    expect(await prisma.sLOWindow.count({ where: { sloDefinitionId: disabledSlo } })).toBe(0);
    expect((await prisma.sLOWindow.findMany({ where: { sloDefinitionId: otherSlo } })).every(row => row.status === "HEALTHY")).toBe(true);
    expect(await prisma.alert.count({ where: { sourceType: "SLO", sourceId: slo, status: "OPEN" } })).toBe(1);
    await evaluate();
    expect(await prisma.alert.count({ where: { sourceType: "SLO", sourceId: slo, status: "OPEN" } })).toBe(1);
  });
});
