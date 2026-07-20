import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { randomUUID } from "crypto";
import { refreshMetricBaselinesForOrg } from "./baseline-calculator.service";
import { reviewPredictionCandidate } from "./prediction-review.service";
import { PREDICTION_REVIEW_STATE } from "./learning-flags";

const runDb = process.env.RUN_DATABASE_E2E === "true";

describe.runIf(runDb)("phase9 learning database e2e", () => {
  const organizationId = randomUUID();
  const projectId = randomUUID();

  afterEach(async () => {
    await prisma.predictionOutcomeEvaluation.deleteMany({ where: { organizationId } });
    await prisma.predictionCandidate.deleteMany({ where: { organizationId } });
    await prisma.metricBaseline.deleteMany({ where: { organizationId } });
    await prisma.checkResult.deleteMany({
      where: { Check: { Service: { projectId } } }
    });
    await prisma.check.deleteMany({ where: { Service: { projectId } } });
    await prisma.service.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });

  it("skips baseline calculation when stage flag is off and reviews predictions with isolation", async () => {
    delete process.env.OPSWATCH_LEARNING_BASELINES_ENABLED;
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: `phase9-${organizationId.slice(0, 8)}`,
        slug: `phase9-${organizationId.slice(0, 8)}`,
        updatedAt: new Date()
      }
    });
    await prisma.project.create({
      data: {
        id: projectId,
        name: "phase9-live",
        slug: `phase9-live-${projectId.slice(0, 8)}`,
        clientName: "Phase9",
        environment: "production",
        organizationId,
        apiKey: `key-${projectId}`,
        signingSecret: `secret-${projectId}`,
        updatedAt: new Date()
      }
    });

    const skipped = await refreshMetricBaselinesForOrg(organizationId);
    expect(skipped.skipped).toBe(true);

    process.env.OPSWATCH_LEARNING_BASELINES_ENABLED = "true";
    const serviceId = randomUUID();
    const checkId = randomUUID();
    await prisma.service.create({
      data: {
        id: serviceId,
        projectId,
        name: "api",
        type: "API",
        updatedAt: new Date()
      }
    });
    await prisma.check.create({
      data: {
        id: checkId,
        serviceId,
        name: "health",
        type: "HTTP",
        intervalSeconds: 60,
        timeoutMs: 5000,
        updatedAt: new Date()
      }
    });
    for (let i = 0; i < 15; i += 1) {
      await prisma.checkResult.create({
        data: {
          id: randomUUID(),
          checkId,
          status: "PASS",
          responseTimeMs: 100 + i,
          checkedAt: new Date()
        }
      });
    }

    const refreshed = await refreshMetricBaselinesForOrg(organizationId);
    expect(refreshed.skipped).toBe(false);
    expect(refreshed.upserted).toBeGreaterThan(0);

    const baseline = await prisma.metricBaseline.findFirst({
      where: { organizationId, metricKey: "response_time_ms" }
    });
    expect(baseline?.sampleCount).toBeGreaterThanOrEqual(12);
    expect(baseline?.dataQualityState).toBe("LIVE");

    const otherOrg = randomUUID();
    await prisma.organization.create({
      data: {
        id: otherOrg,
        name: `other-${otherOrg.slice(0, 8)}`,
        slug: `other-${otherOrg.slice(0, 8)}`,
        updatedAt: new Date()
      }
    });
    const predictionId = randomUUID();
    await prisma.predictionCandidate.create({
      data: {
        id: predictionId,
        organizationId,
        predictionType: "LIKELY_SLO_BREACH",
        title: "Test candidate",
        summary: "Evidence-backed fixture for review",
        confidenceScore: 0.8,
        confidenceLabel: "HIGH",
        status: "READY",
        reviewState: PREDICTION_REVIEW_STATE.NEEDS_REVIEW,
        forecastHorizonMs: 86_400_000,
        evidenceJson: { samples: 20 },
        expiresAt: new Date(Date.now() + 86_400_000),
        updatedAt: new Date()
      }
    });

    const denied = await reviewPredictionCandidate({
      organizationId: otherOrg,
      predictionId,
      action: "confirm",
      actorUserId: "tester"
    });
    expect(denied.ok).toBe(false);

    const confirmed = await reviewPredictionCandidate({
      organizationId,
      predictionId,
      action: "confirm",
      actorUserId: "tester",
      note: "admin confirmed"
    });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.reviewState).toBe(PREDICTION_REVIEW_STATE.CONFIRMED);

    await prisma.organization.delete({ where: { id: otherOrg } });
    delete process.env.OPSWATCH_LEARNING_BASELINES_ENABLED;
  });
});
