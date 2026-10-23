import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../lib/prisma";
import { buildAiOperationsStatus } from "./ai-operations-status.service";
import { recordProviderCall } from "../ai/provider-call-evidence.service";

describe.runIf(process.env.RUN_DATABASE_E2E === "true")("project AI status evidence", () => {
  const org = randomUUID(), project = randomUUID(), otherProject = randomUUID();
  const now = new Date();
  beforeAll(async () => {
    await prisma.organization.create({ data: { id: org, slug: org, name: "Status fixture", updatedAt: now } });
    for (const id of [project, otherProject]) await prisma.project.create({ data: { id, organizationId: org, name: id, slug: id,
      clientName: "Disposable", environment: "test", apiKey: randomUUID(), signingSecret: randomUUID(), updatedAt: now } });
    for (const [id, label] of [[project, "Own decision"], [otherProject, "Other private decision"]]) await prisma.aiDecisionAudit.create({ data: {
      id: randomUUID(), organizationId: org, decisionType: "DIAGNOSIS", subjectType: "PROJECT", subjectId: id, summary: label,
      confidenceScore: 0.95, createdAt: now
    } });
    for (const [title, confidence, state, expires, target] of [
      ["Eligible forecast", 0.95, "NEEDS_REVIEW", 60_000, project],
      ["Expired forecast", 0.95, "NEEDS_REVIEW", -60_000, project],
      ["Low confidence", 0.1, "NEEDS_REVIEW", 60_000, project],
      ["Dismissed forecast", 0.95, "DISMISSED", 60_000, project],
      ["Other private forecast", 0.95, "NEEDS_REVIEW", 60_000, otherProject]
    ] as const) await prisma.predictionCandidate.create({ data: { id: randomUUID(), organizationId: org, projectId: target,
      predictionType: "LIKELY_SLO_BREACH", title, summary: title, confidenceScore: confidence, status: "READY", reviewState: state,
      computedAt: now, expiresAt: new Date(now.getTime() + expires) } });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.predictionCandidate.deleteMany({ where: { organizationId: org } });
    await prisma.aiDecisionAudit.deleteMany({ where: { organizationId: org } });
    await prisma.auditLog.deleteMany({ where: { organizationId: org } });
    await prisma.project.deleteMany({ where: { organizationId: org } });
    await prisma.organization.deleteMany({ where: { id: org } });
  });
  it("does not borrow another project's activity or count expired or dismissed forecasts", async () => {
    vi.stubEnv("OPSWATCH_PREDICTIONS_ENABLED", "true");
    const status = await buildAiOperationsStatus({ organizationId: org, projectId: project, now });
    const predictions = status.capabilities.find(row => row.id === "prediction_engine");
    expect(predictions?.evidence.candidatesStored7d).toBe(1);
    expect(predictions?.evidence.latestTitle).toBe("Eligible forecast");
    expect(JSON.stringify(status)).not.toContain("Other private");
    expect(status.capabilities.find(row => row.id === "advanced_diagnosis")?.summary).toContain("Own decision");
  });
  it("requires model-call evidence from the selected project", async () => {
    vi.stubEnv("INCIDENT_AI_LLM_ENABLED", "true"); vi.stubEnv("OPENAI_API_KEY", "test-only-not-used");
    await recordProviderCall({ organizationId: org, projectId: otherProject, model: "gpt-4o-mini", state: "SUCCEEDED", httpStatus: 200 });
    const missing = await buildAiOperationsStatus({ organizationId: org, projectId: project });
    expect(missing.capabilities.find(row => row.id === "llm_diagnosis")?.evidence.liveProviderVerified).toBe(false);
    await recordProviderCall({ organizationId: org, projectId: project, model: "gpt-4o-mini", state: "SUCCEEDED", httpStatus: 200 });
    const ready = await buildAiOperationsStatus({ organizationId: org, projectId: project });
    expect(ready.capabilities.find(row => row.id === "llm_diagnosis")?.tone).toBe("green");
  });
});
