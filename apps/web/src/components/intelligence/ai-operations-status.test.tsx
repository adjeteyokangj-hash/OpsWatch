import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AiOperationsStatus } from "./ai-operations-status";
import type { AiOperationsStatusPayload } from "../../lib/api";

const greenProof: AiOperationsStatusPayload = {
  asOf: "2026-07-20T19:00:00.000Z",
  overall: {
    modeLabel: "AI-led operations active",
    tone: "green",
    summary: "Worker runtime, learning and AI decision evidence are active."
  },
  lastAiDecision: {
    at: "2026-07-20T18:50:00.000Z",
    summary: "Automated allowlisted restart",
    kind: "automation"
  },
  capabilities: [
    { id: "overall_mode", label: "Overall mode", tone: "green", summary: "AI-led", lastEvidenceAt: "2026-07-20T18:50:00.000Z", evidence: {} },
    { id: "prediction_engine", label: "Prediction engine", tone: "green", summary: "3 candidates", lastEvidenceAt: "2026-07-20T18:40:00.000Z", evidence: { enabled: true } },
    { id: "prediction_notifications", label: "Prediction notifications", tone: "green", summary: "Effective", lastEvidenceAt: null, evidence: {} },
    { id: "learning_engine", label: "Learning engine", tone: "green", summary: "Baselines ready", lastEvidenceAt: null, evidence: {} },
    { id: "preventive_recommendations", label: "Preventive recommendations", tone: "green", summary: "Effective", lastEvidenceAt: null, evidence: {} },
    { id: "advanced_diagnosis", label: "Advanced diagnosis", tone: "green", summary: "Diagnosed", lastEvidenceAt: "2026-07-20T18:45:00.000Z", evidence: {} },
    { id: "safe_auto_healing", label: "Safe auto-healing", tone: "green", summary: "Run verified", lastEvidenceAt: "2026-07-20T18:50:00.000Z", evidence: {} },
    { id: "recovery_verification", label: "Recovery verification", tone: "green", summary: "Effective", lastEvidenceAt: null, evidence: {} },
    { id: "topology_learning", label: "Topology learning", tone: "amber", summary: "Waiting", lastEvidenceAt: null, evidence: {} },
    { id: "worker_heartbeat", label: "Worker runtime", tone: "green", summary: "Recent", lastEvidenceAt: "2026-07-20T18:55:00.000Z", evidence: {} },
    { id: "last_ai_decision", label: "Last AI decision", tone: "green", summary: "Automated allowlisted restart", lastEvidenceAt: "2026-07-20T18:50:00.000Z", evidence: {} }
  ],
  blocked: [],
  recentDecisions: [
    {
      id: "r1",
      kind: "automation",
      summary: "Automated allowlisted restart",
      decisionType: "ALERT",
      confidence: 0.91,
      outcome: "VERIFIED",
      at: "2026-07-20T18:50:00.000Z"
    }
  ]
};

const limitedProof: AiOperationsStatusPayload = {
  asOf: "2026-07-20T19:00:00.000Z",
  overall: {
    modeLabel: "AI running — predictions off",
    tone: "amber",
    summary: "Predictions are off in production configuration. Worker, learning and non-predictive AI operations can continue."
  },
  lastAiDecision: { at: null, summary: null, kind: null },
  capabilities: [
    { id: "overall_mode", label: "Overall mode", tone: "amber", summary: "AI limited", lastEvidenceAt: null, evidence: {} },
    { id: "prediction_engine", label: "Prediction engine", tone: "red", summary: "Predictions are disabled — no live forecast emission.", lastEvidenceAt: null, evidence: { enabled: false } },
    { id: "worker_heartbeat", label: "Worker runtime", tone: "green", summary: "Worker tick completed 1m ago.", lastEvidenceAt: null, evidence: {} }
  ],
  blocked: [
    { id: "prediction_engine", label: "Prediction engine", reason: "Predictions are disabled." }
  ],
  recentDecisions: []
};

describe("AiOperationsStatus", () => {
  it("shows green AI-led proof with last decision timestamp", () => {
    const html = renderToStaticMarkup(<AiOperationsStatus status={greenProof} />);
    expect(html).toContain("AI-led operations active");
    expect(html).toContain('data-tone="green"');
    expect(html).toContain("Last AI decision");
    expect(html).toContain("Prediction notifications");
    expect(html).toContain("Topology learning");
    expect(html).toContain("None");
    expect(html).toContain("no red");
    expect(html).toContain("Recent AI decisions");
  });

  it("lists unavailable prediction capability without claiming the whole AI runtime is blocked", () => {
    const html = renderToStaticMarkup(<AiOperationsStatus status={limitedProof} />);
    expect(html).toContain("AI running — predictions off");
    expect(html).toContain("Prediction engine");
    expect(html).toContain("Predictions are disabled.");
  });

  it("compact card shows limited AI, running worker and the correct configuration link", () => {
    const html = renderToStaticMarkup(
      <AiOperationsStatus status={limitedProof} compact projectId="proj_1" />
    );

    expect(html).toContain("ai-ops-status--compact");
    expect(html).toContain("AI operations");
    expect(html).toContain("Limited");
    expect(html).toContain("Worker: Running");
    expect(html).toContain("Predictions: Off");
    expect(html).toContain("Review AI configuration");
    expect(html).toContain('/settings/ai-automation-policies');
    expect(html).not.toContain("Blocked</span>");
    expect(html).not.toContain("AI-led configured — blocked");
  });

  it("organization compact card links to the full Intelligence page when predictions are available", () => {
    const html = renderToStaticMarkup(<AiOperationsStatus status={greenProof} compact />);
    expect(html).toContain("Review full AI status");
    expect(html).toContain('href="/intelligence"');
  });
});
