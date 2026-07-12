import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { diagnose } from "./incident-ai.service";

type EvalCase = {
  id: string;
  description: string;
  input: Parameters<typeof diagnose>[0];
  expect: {
    category?: string;
    minConfidence?: number;
    maxConfidence?: number;
    failureClass?: string;
    actionsInclude?: string[];
  };
};

const loadCases = (): EvalCase[] => {
  const here = dirname(fileURLToPath(import.meta.url));
  const datasetPath = join(here, "../../../../../packages/shared/src/evals/incident-diagnosis-cases.json");
  return JSON.parse(readFileSync(datasetPath, "utf8")) as EvalCase[];
};

describe("incident diagnosis eval dataset", () => {
  const cases = loadCases();

  it(`loads ${cases.length} benchmark cases`, () => {
    expect(cases.length).toBeGreaterThanOrEqual(8);
  });

  for (const testCase of cases) {
    it(`${testCase.id}: ${testCase.description}`, () => {
      const result = diagnose(testCase.input);

      if (testCase.expect.category) {
        expect(result.category).toBe(testCase.expect.category);
      }
      if (testCase.expect.failureClass) {
        expect(result.failureClass).toBe(testCase.expect.failureClass);
      }
      if (testCase.expect.minConfidence != null) {
        expect(result.confidence).toBeGreaterThanOrEqual(testCase.expect.minConfidence);
      }
      if (testCase.expect.maxConfidence != null) {
        expect(result.confidence).toBeLessThanOrEqual(testCase.expect.maxConfidence);
      }
      for (const action of testCase.expect.actionsInclude ?? []) {
        expect(result.suggestedActions).toContain(action);
      }
      if (testCase.expect.actionsInclude?.length === 0) {
        expect(result.suggestedActions).toEqual([]);
      }
    });
  }
});

describe("incident llm schema validation", () => {
  it("rejects invalid category values", async () => {
    const { parseIncidentLlmDiagnosis } = await import("@opswatch/shared");
    const parsed = parseIncidentLlmDiagnosis({
      diagnosis: "Service unavailable due to upstream dependency failure in Redis cache layer.",
      rootCauseHypothesis: "Redis connection pool exhausted after worker restart loop.",
      confidence: 0.91,
      category: "NOT_A_REAL_CATEGORY"
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts valid diagnosis payloads", async () => {
    const { parseIncidentLlmDiagnosis } = await import("@opswatch/shared");
    const parsed = parseIncidentLlmDiagnosis({
      diagnosis: "Checkout API latency increased after Redis cache became unavailable for session lookups.",
      rootCauseHypothesis: "Redis cache outage caused downstream auth/session lookups to fail.",
      confidence: 0.82,
      category: "RELIABILITY"
    });
    expect(parsed.success).toBe(true);
  });
});
