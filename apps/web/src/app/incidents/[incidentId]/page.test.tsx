import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useParams: () => ({ incidentId: "inc-1" })
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => React.createElement("a", { href, className }, children)
}));

vi.mock("../../../components/layout/shell", () => ({
  Shell: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children)
}));

vi.mock("../../../components/layout/header", () => ({
  Header: ({ title }: { title: string }) => React.createElement("h1", null, title)
}));

const mockApiFetch = vi.fn();
vi.mock("../../../lib/api", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args)
}));

import IncidentDetailPage from "./page";

describe("incident AI panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => store.clear()
      }
    });
    mockApiFetch.mockImplementation((path: string) => {
      if (path === "/incidents/inc-1") {
        return Promise.resolve({
          id: "inc-1",
          title: "Webhook outage",
          severity: "HIGH",
          status: "OPEN",
          openedAt: new Date().toISOString(),
          acknowledgedAt: null,
          resolvedAt: null,
          rootCause: null,
          resolutionNotes: null,
          project: { id: "proj-1", name: "Noble Express" },
          alerts: []
        });
      }
      if (path === "/incidents/inc-1/timeline") {
        return Promise.resolve([
          {
            id: "te-1",
            eventType: "INCIDENT_OPENED",
            summary: "Incident opened: Webhook outage",
            sourceType: "INCIDENT",
            sourceId: "inc-1",
            severity: null,
            occurredAt: new Date().toISOString()
          }
        ]);
      }
      if (path === "/incidents/inc-1/root-cause-candidates") {
        return Promise.resolve([
          {
            kind: "CHANGE_EVENT",
            referenceId: "ce-1",
            title: "DEPLOY_FINISHED: webhook service rollout",
            score: 0.82,
            rationale: "Change happened near incident start.",
            metadata: {}
          }
        ]);
      }
      if (path === "/remediation/suggest") {
        return Promise.resolve({
          diagnosis: "Webhook delivery is failing.",
          confidence: 0.85,
          category: "RELIABILITY",
          suggestedActions: [
            {
              action: "RETRY_WEBHOOKS",
              label: "Retry webhooks",
              description: "Replay failed outbound webhook deliveries.",
              group: "GROUP_A_SAFE",
              requiresApproval: false,
              kind: "fix",
              state: "READY",
              confidenceLabel: "HIGH",
              confidenceScore: 85,
              policyTier: "SAFE_AUTOMATIC",
              impactTier: "LOW",
              autoRunEligible: true,
              historicalSuccessRate: 0.75,
              suppressionInfo: null,
              confidenceFactors: [
                {
                  name: "Prior success rate",
                  impact: 25,
                  status: "pass",
                  description: "75% historical success rate (50-80%, acceptable)"
                }
              ]
            },
            {
              action: "REQUEST_HUMAN_REVIEW",
              label: "Request human review",
              description: "Escalate for technician review.",
              group: "GROUP_C_SUPPORT",
              requiresApproval: false,
              kind: "support",
              state: "READY",
              confidenceLabel: "MEDIUM",
              confidenceScore: 60,
              policyTier: "MANUAL_ONLY",
              impactTier: "LOW",
              autoRunEligible: false,
              historicalSuccessRate: null,
              suppressionInfo: null,
              confidenceFactors: []
            },
            {
              action: "ROLLBACK_DEPLOYMENT",
              label: "Rollback deployment",
              description: "Trigger deployment rollback.",
              group: "GROUP_B_APPROVAL",
              requiresApproval: true,
              kind: "fix",
              state: "UNSUPPORTED",
              confidenceLabel: "LOW",
              confidenceScore: 42,
              policyTier: "APPROVAL_REQUIRED",
              impactTier: "HIGH",
              autoRunEligible: false,
              historicalSuccessRate: null,
              suppressionInfo: null,
              confidenceFactors: [
                {
                  name: "Insufficient confidence",
                  impact: -20,
                  status: "fail",
                  description: "Risk is too high for automatic execution"
                }
              ]
            }
          ]
        });
      }
      if (path === "/automation/incidents/inc-1/plan") {
        return Promise.resolve({
          playbookKey: "WEBHOOK_DELIVERY_RECOVERY",
          playbookVersion: 1,
          analysisMode: "RULES",
          confidence: 85,
          riskLevel: "LOW",
          executionMode: "OBSERVE",
          reason: "Webhook delivery is failing.",
          steps: [
            {
              order: 1,
              action: "CHECK_PROVIDER_STATUS",
              approvalRequired: false,
              description: "Check provider status."
            }
          ],
          runId: "run-1",
          permissions: { canApprove: false }
        });
      }
      if (path === "/automation/runs/run-1") {
        return Promise.resolve({
          id: "run-1",
          incidentId: "inc-1",
          playbookKey: "WEBHOOK_DELIVERY_RECOVERY",
          playbookVersion: 1,
          executionMode: "OBSERVE",
          status: "PLANNED",
          plan: {
            playbookKey: "WEBHOOK_DELIVERY_RECOVERY",
            playbookVersion: 1,
            analysisMode: "RULES",
            confidence: 85,
            riskLevel: "LOW",
            executionMode: "OBSERVE",
            reason: "Webhook delivery is failing.",
            steps: []
          },
          steps: [],
          permissions: { canApprove: false }
        });
      }
      if (path.startsWith("/remediation/logs")) {
        return Promise.resolve([]);
      }
      if (path === "/remediation/execute") {
        return Promise.resolve({
          action: "RETRY_WEBHOOKS",
          logId: "log-1",
          result: {
            success: true,
            status: "COMPLETED",
            summary: "Webhook redelivery completed.",
            details: {
              recoveryUiLabel: "Repair completed — verification pending",
              executedAt: new Date().toISOString(),
              triggeredBy: "tester"
            }
          }
        });
      }

      return Promise.resolve({});
    });
  });

  it("renders action states and executes ready action", async () => {
    const user = userEvent.setup();
    render(React.createElement(IncidentDetailPage));

    await waitFor(() => {
      expect(screen.getByText("Webhook outage")).toBeTruthy();
    });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/remediation/suggest",
        expect.objectContaining({ method: "POST" })
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Recommended actions")).toBeTruthy();
    });

    const recommended = screen.getByText("Recommended actions").closest("section.page-section");
    expect(recommended).toBeTruthy();
    if (recommended?.getAttribute("data-open") !== "true") {
      await user.click(screen.getByText("Recommended actions").closest("button.page-section-summary")!);
    }

    const refresh = screen.getByRole("button", { name: /Refresh diagnosis/i });
    await user.click(refresh);

    await waitFor(() => {
      expect(recommended?.textContent ?? "").toMatch(/Webhook delivery is failing/);
      expect(recommended?.textContent ?? "").toMatch(/Retry webhooks/);
    });

    expect(screen.getByRole("button", { name: "Request review" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply recommended action" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Apply recommended action" }));

    await waitFor(() => {
      expect(recommended?.textContent ?? "").toMatch(/Repair completed|Webhook redelivery completed|Run again/);
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/remediation/execute",
      expect.objectContaining({ method: "POST" })
    );
  });
});
