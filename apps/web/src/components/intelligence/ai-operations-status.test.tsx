import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AiOperationsStatus } from "./ai-operations-status";
import type { AiOperationsStatusPayload } from "../../lib/api";

const greenProof: AiOperationsStatusPayload = {
  asOf: "2026-07-20T19:00:00.000Z",
  overall: {
    modeLabel: "AI-led operations active",
    tone: "green",
    summary: "Worker pulse is fresh and recent AI decisions are on record.",
  },
  lastAiDecision: {
    at: "2026-07-20T18:50:00.000Z",
    summary: "Automated allowlisted restart",
    kind: "automation",
  },
  capabilities: [
    { id: "overall_mode", label: "Overall mode", tone: "green", summary: "AI-led", lastEvidenceAt: "2026-07-20T18:50:00.000Z", evidence: {} },
    { id: "prediction_engine", label: "Prediction engine", tone: "green", summary: "3 candidates", lastEvidenceAt: "2026-07-20T18:40:00.000Z", evidence: {} },
    { id: "prediction_notifications", label: "Prediction notifications", tone: "green", summary: "Effective", lastEvidenceAt: null, evidence: {} },
    { id: "learning_engine", label: "Learning engine", tone: "green", summary: "Baselines ready", lastEvidenceAt: null, evidence: {} },
    { id: "preventive_recommendations", label: "Preventive recommendations", tone: "green", summary: "Effective", lastEvidenceAt: null, evidence: {} },
    { id: "advanced_diagnosis", label: "Advanced diagnosis", tone: "green", summary: "Diagnosed", lastEvidenceAt: "2026-07-20T18:45:00.000Z", evidence: {} },
    { id: "safe_auto_healing", label: "Safe auto-healing", tone: "green", summary: "Run verified", lastEvidenceAt: "2026-07-20T18:50:00.000Z", evidence: {} },
    { id: "recovery_verification", label: "Recovery verification", tone: "green", summary: "Effective", lastEvidenceAt: null, evidence: {} },
    { id: "topology_learning", label: "Topology learning", tone: "amber", summary: "Waiting", lastEvidenceAt: null, evidence: {} },
    { id: "worker_heartbeat", label: "Worker heartbeat", tone: "green", summary: "Recent", lastEvidenceAt: "2026-07-20T18:55:00.000Z", evidence: {} },
    { id: "last_ai_decision", label: "Last AI decision", tone: "green", summary: "Automated allowlisted restart", lastEvidenceAt: "2026-07-20T18:50:00.000Z", evidence: {} },
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
      at: "2026-07-20T18:50:00.000Z",
    },
  ],
};

const redProof: AiOperationsStatusPayload = {
  asOf: "2026-07-20T19:00:00.000Z",
  overall: { modeLabel: "Safety-gated", tone: "red", summary: "Predictions off." },
  lastAiDecision: { at: null, summary: null, kind: null },
  capabilities: [
    { id: "overall_mode", label: "Overall mode", tone: "red", summary: "Safety-gated", lastEvidenceAt: null, evidence: {} },
    { id: "prediction_engine", label: "Prediction engine", tone: "red", summary: "Off", lastEvidenceAt: null, evidence: {} },
    { id: "worker_heartbeat", label: "Worker heartbeat", tone: "red", summary: "No heartbeat", lastEvidenceAt: null, evidence: {} },
  ],
  blocked: [
    { id: "prediction_engine", label: "Prediction engine", reason: "Predictions are disabled." },
    { id: "worker_heartbeat", label: "Worker heartbeat", reason: "No heartbeat recorded." },
  ],
  recentDecisions: [],
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

  it("lists blocked capabilities when red", () => {
    const html = renderToStaticMarkup(<AiOperationsStatus status={redProof} />);
    expect(html).toContain("Safety-gated");
    expect(html).toContain("Prediction engine");
    expect(html).toContain("Predictions are disabled.");
  });

  it("compact strip uses overall mode and last decision", () => {
    const html = renderToStaticMarkup(
      <AiOperationsStatus status={greenProof} compact projectId="proj_1" />,
    );
    expect(html).toContain("ai-ops-status--compact");
    expect(html).toContain("AI-led operations active");
    expect(html).toContain("/projects/proj_1/settings?tab=automation");
  });
});
