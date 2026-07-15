import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TopologyRelationshipDrawer,
  evaluateRelationshipAutomation
} from "./topology-relationship-drawer";
import type { SelectedTopologyEdge } from "./topology-edge-style";
import type { ProjectTopologyResponse } from "./topology-types";

const edge: SelectedTopologyEdge = {
  id: "edge-critical",
  kind: "dependency",
  sourceId: "mod-a",
  targetId: "svc-b",
  sourceName: "Checkout",
  targetName: "Payments API",
  status: "CRITICAL",
  critical: false,
  colourMeaning: "Red solid — failing dependency.",
  writtenHealth: "Critical",
  colourReason: "Selected because a failed check or critical/high alert is linked to an endpoint of this relationship."
};

const topology: ProjectTopologyResponse = {
  project: { id: "proj-1", name: "Noble Express", status: "DEGRADED" },
  generatedAt: new Date().toISOString(),
  nodes: [
    {
      id: "mod-a",
      name: "Checkout",
      type: "MODULE",
      status: "DEGRADED",
      parentId: null,
      metrics: {
        availabilityPercent: 90,
        latencyMs: 240,
        errorRatePercent: 4.2,
        sloBurnRate: 2,
        availabilityTrend: [90]
      },
      risk: { openAlerts: 1, unresolvedIncidents: 0 }
    },
    {
      id: "svc-b",
      name: "Payments API",
      type: "COMPONENT",
      status: "CRITICAL",
      parentId: null,
      metrics: {
        availabilityPercent: 40,
        latencyMs: 900,
        errorRatePercent: 18,
        sloBurnRate: 5,
        availabilityTrend: [40]
      },
      risk: { openAlerts: 1, unresolvedIncidents: 1 }
    }
  ],
  edges: [
    {
      id: "edge-critical",
      sourceId: "mod-a",
      targetId: "svc-b",
      type: "DEPENDENCY",
      critical: false,
      status: "CRITICAL"
    }
  ],
  summary: {
    total: 2,
    healthy: 0,
    degraded: 1,
    critical: 1,
    unknown: 0,
    openAlerts: 1,
    openIncidents: 1
  },
  nodeContext: {
    "mod-a": {
      monitoringState: "MONITORED",
      lastCheckAt: "2026-07-15T10:00:00.000Z",
      lastCheckStatus: "FAIL",
      sloStatus: "BREACHED",
      openAlerts: [{ id: "alert-1", title: "Payments dependency failing", severity: "HIGH", status: "OPEN" }],
      unresolvedIncidents: [{ id: "inc-1", title: "Checkout degradation", severity: "HIGH" }],
      upstreamIds: [],
      downstreamIds: ["svc-b"]
    },
    "svc-b": {
      monitoringState: "MONITORED",
      lastCheckAt: "2026-07-15T10:01:00.000Z",
      lastCheckStatus: "FAIL",
      sloStatus: "BREACHED",
      openAlerts: [],
      unresolvedIncidents: [],
      upstreamIds: ["mod-a"],
      downstreamIds: []
    }
  }
};

describe("TopologyRelationshipDrawer", () => {
  afterEach(() => cleanup());

  it("shows source, target, written health, colour meaning, and related alert", () => {
    const evaluation = evaluateRelationshipAutomation({ edge, projectAutomationMode: "OBSERVE" });
    render(
      <TopologyRelationshipDrawer
        edge={edge}
        topology={topology}
        projectId="proj-1"
        evaluation={evaluation}
        onClose={vi.fn()}
        onFixWithAutomation={vi.fn()}
      />
    );

    expect(screen.getByTestId("topology-relationship-drawer")).toBeInTheDocument();
    expect(screen.getByText("Checkout")).toBeInTheDocument();
    expect(screen.getByText("Payments API")).toBeInTheDocument();
    expect(screen.getByTestId("topology-edge-colour-meaning")).toHaveTextContent(/Red solid/i);
    expect(screen.getAllByText(/Payments dependency failing/i).length).toBeGreaterThanOrEqual(1);
  });

  it("disables Fix with automation when setup is required (no connector)", () => {
    const evaluation = evaluateRelationshipAutomation({ edge, projectAutomationMode: "APPROVAL" });
    expect(evaluation.buttonState).toBe("setup_required");
    render(
      <TopologyRelationshipDrawer
        edge={edge}
        topology={topology}
        projectId="proj-1"
        evaluation={evaluation}
        onClose={vi.fn()}
        onFixWithAutomation={vi.fn()}
      />
    );
    const button = screen.getByTestId("topology-fix-with-automation");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("data-state", "setup_required");
  });
});

describe("evaluateRelationshipAutomation", () => {
  it("returns setup_required when no remediation capability exists", () => {
    expect(evaluateRelationshipAutomation({ edge }).buttonState).toBe("setup_required");
  });

  it("returns no_automated_fix in Observe mode even when a remediator exists", () => {
    const result = evaluateRelationshipAutomation({
      edge,
      projectAutomationMode: "OBSERVE",
      hasRemediationCapability: true
    });
    expect(result.buttonState).toBe("no_automated_fix");
    expect(result.reason).toMatch(/Observe mode/i);
  });

  it("returns approval_required in Approval mode when a remediator exists", () => {
    const result = evaluateRelationshipAutomation({
      edge,
      projectAutomationMode: "APPROVAL",
      hasRemediationCapability: true
    });
    expect(result.buttonState).toBe("approval_required");
  });

  it("returns ready in Autonomous mode for non-critical low-risk actions", () => {
    const result = evaluateRelationshipAutomation({
      edge: { ...edge, critical: false },
      projectAutomationMode: "AUTONOMOUS",
      hasRemediationCapability: true
    });
    expect(result.buttonState).toBe("ready");
  });

  it("requires approval in Autonomous mode for critical/high-risk actions", () => {
    const result = evaluateRelationshipAutomation({
      edge: { ...edge, critical: true },
      projectAutomationMode: "AUTONOMOUS",
      hasRemediationCapability: true
    });
    expect(result.buttonState).toBe("approval_required");
  });
});
