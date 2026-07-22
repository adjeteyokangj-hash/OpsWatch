import { describe, expect, it } from "vitest";
import type { AiOperationsStatusPayload, OpsStatusCapability } from "./ai-operations-status.service";
import { mergeAiOperationsRuntimeStatus } from "./ai-operations-runtime-status.service";
import type { WorkerRuntimeStatus } from "../worker-tick/worker-runtime-status.service";

const capability = (
  id: string,
  tone: "green" | "amber" | "red",
  summary: string,
  evidence: Record<string, unknown> = {}
): OpsStatusCapability => ({
  id,
  label: id,
  tone,
  summary,
  lastEvidenceAt: null,
  evidence
});

const baseStatus = (predictionTone: "green" | "amber" | "red" = "amber"): AiOperationsStatusPayload => ({
  asOf: "2026-07-22T08:00:00.000Z",
  overall: {
    modeLabel: "AI-led configured — blocked",
    tone: "red",
    summary: "Legacy application heartbeat is stale."
  },
  lastAiDecision: {
    at: "2026-07-22T07:55:00.000Z",
    summary: "Recent diagnosis",
    kind: "audit"
  },
  capabilities: [
    capability("overall_mode", "red", "legacy", { profile: "ai_led_safe" }),
    capability("prediction_engine", predictionTone, predictionTone === "red" ? "Predictions are disabled." : "Building evidence", {
      enabled: predictionTone !== "red"
    }),
    capability("learning_engine", "green", "Learning active"),
    capability("last_ai_decision", "green", "Recent decision"),
    capability("worker_heartbeat", "red", "Legacy application heartbeat stale")
  ],
  blocked: [
    { id: "worker_heartbeat", label: "Worker heartbeat", reason: "Legacy heartbeat stale" }
  ],
  recentDecisions: []
});

const worker = (tone: "green" | "amber" | "red"): WorkerRuntimeStatus => ({
  capability: capability(
    "worker_heartbeat",
    tone,
    tone === "green" ? "Worker tick completed 1m ago." : "Worker runtime is unavailable."
  ),
  blocked:
    tone === "red"
      ? [{ id: "worker_runtime_unhealthy", label: "Worker runtime", reason: "Worker runtime is unavailable." }]
      : []
});

describe("mergeAiOperationsRuntimeStatus", () => {
  it("removes the legacy heartbeat contradiction when the real worker is healthy", () => {
    const merged = mergeAiOperationsRuntimeStatus(baseStatus("amber"), worker("green"));

    expect(merged.overall.tone).toBe("amber");
    expect(merged.overall.modeLabel).toBe("AI operations — building evidence");
    expect(merged.overall.summary).toMatch(/building evidence/i);
    expect(merged.capabilities.find((row) => row.id === "worker_heartbeat")?.tone).toBe("green");
    expect(merged.blocked.some((row) => row.id === "worker_heartbeat")).toBe(false);
  });

  it("states that predictions are off when the worker is healthy but predictions are disabled", () => {
    const merged = mergeAiOperationsRuntimeStatus(baseStatus("red"), worker("green"));

    expect(merged.overall.tone).toBe("red");
    expect(merged.overall.modeLabel).toBe("AI configured — predictions off");
    expect(merged.overall.summary).toBe("Predictions are disabled.");
  });

  it("prioritises an unavailable worker over other AI capability states", () => {
    const merged = mergeAiOperationsRuntimeStatus(baseStatus("green"), worker("red"));

    expect(merged.overall.modeLabel).toBe("AI configured — worker unavailable");
    expect(merged.overall.tone).toBe("red");
    expect(merged.blocked.some((row) => row.id === "worker_runtime_unhealthy")).toBe(true);
  });
});
