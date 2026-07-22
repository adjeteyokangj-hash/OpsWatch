import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  organizationFindMany,
  refreshBaselines,
  detectAnomalies,
  refreshPatterns,
  detectDeterioration,
  generatePredictions,
  learnRemediation,
  applyRetention,
  ensureVersions
} = vi.hoisted(() => ({
  organizationFindMany: vi.fn(),
  refreshBaselines: vi.fn(),
  detectAnomalies: vi.fn(),
  refreshPatterns: vi.fn(),
  detectDeterioration: vi.fn(),
  generatePredictions: vi.fn(),
  learnRemediation: vi.fn(),
  applyRetention: vi.fn(),
  ensureVersions: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: { organization: { findMany: organizationFindMany } }
}));
vi.mock("./baseline-calculator.service", () => ({ refreshMetricBaselinesForOrg: refreshBaselines }));
vi.mock("./anomaly-detection.service", () => ({ detectAnomaliesForOrg: detectAnomalies }));
vi.mock("./incident-pattern.service", () => ({ refreshIncidentPatternMemory: refreshPatterns }));
vi.mock("./deterioration.service", () => ({ detectDeteriorationForOrg: detectDeterioration }));
vi.mock("./prediction-candidate.service", () => ({ generatePredictionCandidates: generatePredictions }));
vi.mock("./remediation-outcome.service", () => ({ learnFromRemediationOutcomes: learnRemediation }));
vi.mock("./learning-retention.service", () => ({
  applyLearningRetentionExpiry: applyRetention,
  ensureAlgorithmVersionsRegistered: ensureVersions
}));
vi.mock("./learning-flags", () => ({ listLearningStages: () => [] }));

import { runLearningCycleForAllOrgs } from "./learning-cycle.service";

describe("runLearningCycleForAllOrgs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    organizationFindMany.mockResolvedValue([{ id: "org-a" }, { id: "org-b" }, { id: "org-c" }]);
    ensureVersions.mockResolvedValue(undefined);
    refreshBaselines.mockImplementation(async (orgId: string) => {
      if (orgId === "org-b") throw new Error("baseline source unavailable");
      return { organizationId: orgId };
    });
    detectAnomalies.mockResolvedValue({ count: 0 });
    refreshPatterns.mockResolvedValue({ count: 0 });
    detectDeterioration.mockResolvedValue({ count: 0 });
    generatePredictions.mockResolvedValue({ count: 0 });
    learnRemediation.mockResolvedValue({ count: 0 });
    applyRetention.mockResolvedValue({ count: 0 });
  });

  it("continues later organisations after one organisation fails", async () => {
    const result = await runLearningCycleForAllOrgs();

    expect(result.orgCount).toBe(3);
    expect(result.succeededOrgCount).toBe(2);
    expect(result.failedOrgCount).toBe(1);
    expect(result.results.map((row) => row.organizationId)).toEqual(["org-a", "org-c"]);
    expect(result.failures).toEqual([
      { organizationId: "org-b", error: "baseline source unavailable" }
    ]);
    expect(refreshBaselines).toHaveBeenCalledWith("org-c");
  });
});
