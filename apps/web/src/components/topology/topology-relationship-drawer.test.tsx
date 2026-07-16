import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TopologyRelationshipDrawer,
  buildExecutionBlockers,
  evaluateRelationshipAutomation,
  relationshipSetupHrefs,
  resolveAutomationConfidence
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

const renderDrawer = (evaluation: ReturnType<typeof evaluateRelationshipAutomation>) =>
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

describe("TopologyRelationshipDrawer", () => {
  afterEach(() => cleanup());

  it("shows source, target, written health, colour meaning, and related alert", () => {
    const evaluation = evaluateRelationshipAutomation({
      edge,
      topology,
      projectAutomationMode: "OBSERVE",
      hasRemediationCapability: true
    });
    renderDrawer(evaluation);

    expect(screen.getByTestId("topology-relationship-drawer")).toBeInTheDocument();
    expect(screen.getByText("Checkout")).toBeInTheDocument();
    expect(screen.getByText("Payments API")).toBeInTheDocument();
    expect(screen.getByTestId("topology-edge-colour-meaning")).toHaveTextContent(/Red solid/i);
    expect(screen.getAllByText(/Payments dependency failing/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders Connect Remediator CTA linking to the remediator integration when setup is required", () => {
    const evaluation = evaluateRelationshipAutomation({
      edge,
      topology,
      projectAutomationMode: "APPROVAL"
    });
    expect(evaluation.buttonState).toBe("setup_required");
    renderDrawer(evaluation);

    const cta = screen.getByTestId("topology-fix-with-automation");
    expect(cta).toHaveAttribute("data-state", "setup_required");
    const href = cta.getAttribute("href") ?? "";
    expect(href).toContain("/projects/proj-1/integrations/worker_provider?");
    expect(href).toContain("returnTo=");
    expect(cta).toHaveTextContent("Connect Remediator to Enable Repair");
    expect(cta.tagName).toBe("A");
    expect(cta).not.toBeDisabled();

    expect(screen.getByTestId("topology-setup-required-status")).toHaveTextContent(
      /Setup required — connect and validate a remediator/i
    );
  });

  it("renders evidence section from monitoring signals", () => {
    const evaluation = evaluateRelationshipAutomation({
      edge,
      topology,
      projectAutomationMode: "APPROVAL",
      hasRemediationCapability: true
    });
    renderDrawer(evaluation);

    expect(screen.getByTestId("topology-automation-evidence")).toBeInTheDocument();
    expect(screen.getByTestId("topology-evidence-summary")).toHaveTextContent(/Monitoring signals/i);
    expect(screen.getByTestId("topology-automation-evidence")).toHaveTextContent(/Failed checks/i);
    expect(screen.getByTestId("topology-automation-evidence")).toHaveTextContent(/Checkout/);
  });

  it("shows observe blocker checklist and Enable Autonomous Mode CTA when policy allows", () => {
    const evaluation = evaluateRelationshipAutomation({
      edge,
      topology,
      projectAutomationMode: "OBSERVE",
      hasRemediationCapability: true,
      policyAllowsModeChange: true
    });
    expect(evaluation.buttonState).toBe("observe_blocked");
    renderDrawer(evaluation);

    expect(screen.getByTestId("topology-blocker-observe_mode")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("topology-fix-with-automation")).toHaveTextContent("Enable Autonomous Mode");
    expect(screen.getByTestId("topology-automation-mode-badge")).toHaveTextContent("Observe");
  });

  it("hides Enable Autonomous Mode when policy forbids mode change", () => {
    const evaluation = evaluateRelationshipAutomation({
      edge,
      topology,
      projectAutomationMode: "OBSERVE",
      hasRemediationCapability: true,
      policyAllowsModeChange: false
    });
    renderDrawer(evaluation);

    expect(screen.queryByTestId("topology-fix-with-automation")).not.toBeInTheDocument();
    expect(screen.getByTestId("topology-observe-blocked-note")).toHaveTextContent(/Observe mode blocks execution/i);
  });

  it("shows approval CTA label and awaiting approval blocker", () => {
    const evaluation = evaluateRelationshipAutomation({
      edge,
      topology,
      projectAutomationMode: "APPROVAL",
      hasRemediationCapability: true
    });
    renderDrawer(evaluation);

    expect(screen.getByTestId("topology-fix-with-automation")).toHaveTextContent("Request Approval");
    expect(screen.getByTestId("topology-blocker-awaiting_approval")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("topology-automation-mode-badge")).toHaveTextContent("Approval Required");
  });

  it("does not show fake confidence when learning data is absent", () => {
    const evaluation = evaluateRelationshipAutomation({
      edge,
      topology,
      projectAutomationMode: "APPROVAL",
      hasRemediationCapability: true
    });
    renderDrawer(evaluation);

    expect(screen.getByTestId("topology-automation-confidence")).toHaveTextContent(
      /Not available \(insufficient learning data\)/i
    );
    expect(screen.getByTestId("topology-automation-confidence")).not.toHaveTextContent(/96%/);
  });

  it("shows real confidence when incident memory score is provided", () => {
    const evaluation = evaluateRelationshipAutomation({
      edge,
      topology,
      projectAutomationMode: "APPROVAL",
      hasRemediationCapability: true,
      incidentMemory: { confidenceScore: 0.82, occurrenceCount: 3 }
    });
    renderDrawer(evaluation);

    expect(screen.getByTestId("topology-automation-confidence")).toHaveTextContent("82%");
    expect(screen.getByTestId("topology-evidence-summary")).toHaveTextContent(/3 prior occurrences/i);
  });

  it("shows risk explanation for high-risk critical edges", () => {
    const evaluation = evaluateRelationshipAutomation({
      edge: { ...edge, critical: true },
      topology,
      projectAutomationMode: "APPROVAL",
      hasRemediationCapability: true
    });
    renderDrawer(evaluation);

    expect(screen.getByTestId("topology-risk-explanation")).toHaveTextContent(/critical dependency edge/i);
  });
});

describe("relationshipSetupHrefs", () => {
  it("points at remediator, project settings, and project-scoped connections with return path", () => {
    const hrefs = relationshipSetupHrefs("proj-1", { edgeId: "edge-critical" });
    expect(hrefs.configuration).toBe("/projects/proj-1/settings");
    expect(hrefs.remediator).toContain("/projects/proj-1/integrations/worker_provider?");
    expect(hrefs.remediator).toContain("returnTo=");
    expect(hrefs.remediator).toContain("edgeId=edge-critical");
    expect(hrefs.connections).toContain("/connections?");
    expect(hrefs.connections).toContain("projectId=proj-1");
    expect(hrefs.automationMode).toBe("/projects/proj-1/automation");
  });
});

describe("evaluateRelationshipAutomation", () => {
  it("returns setup_required when no remediation capability exists", () => {
    expect(evaluateRelationshipAutomation({ edge, topology }).buttonState).toBe("setup_required");
  });

  it("returns remediating when an active run targets the edge", () => {
    const result = evaluateRelationshipAutomation({
      edge,
      topology,
      projectAutomationMode: "APPROVAL",
      hasRemediationCapability: true,
      activeRun: { id: "run-1", incidentId: "inc-1", status: "VERIFYING" }
    });
    expect(result.buttonState).toBe("remediating");
    expect(result.activeIncidentId).toBe("inc-1");
  });

  it("returns observe_blocked in Observe mode when a remediator exists", () => {
    const result = evaluateRelationshipAutomation({
      edge,
      topology,
      projectAutomationMode: "OBSERVE",
      hasRemediationCapability: true
    });
    expect(result.buttonState).toBe("observe_blocked");
    expect(result.reason).toMatch(/Observe mode/i);
    expect(result.executionBlockers.find((row) => row.id === "observe_mode")?.active).toBe(true);
  });

  it("returns approval_required in Approval mode when a remediator exists", () => {
    const result = evaluateRelationshipAutomation({
      edge,
      topology,
      projectAutomationMode: "APPROVAL",
      hasRemediationCapability: true
    });
    expect(result.buttonState).toBe("approval_required");
  });

  it("returns ready in Autonomous mode for non-critical low-risk actions", () => {
    const result = evaluateRelationshipAutomation({
      edge: { ...edge, critical: false },
      topology,
      projectAutomationMode: "AUTONOMOUS",
      hasRemediationCapability: true
    });
    expect(result.buttonState).toBe("ready");
  });

  it("requires approval in Autonomous mode for critical/high-risk actions", () => {
    const result = evaluateRelationshipAutomation({
      edge: { ...edge, critical: true },
      topology,
      projectAutomationMode: "AUTONOMOUS",
      hasRemediationCapability: true
    });
    expect(result.buttonState).toBe("approval_required");
  });
});

describe("buildExecutionBlockers", () => {
  it("marks setup and missing capability blockers separately", () => {
    const blockers = buildExecutionBlockers({
      buttonState: "setup_required",
      automationMode: "APPROVAL",
      hasRemediationCapability: false,
      hasConnectedRemediator: true,
      remediatorEmergencyDisabled: false
    });
    expect(blockers.find((row) => row.id === "no_remediator")?.active).toBe(false);
    expect(blockers.find((row) => row.id === "missing_capability")?.active).toBe(true);
  });
});

describe("resolveAutomationConfidence", () => {
  it("returns unavailable label without incident memory", () => {
    expect(resolveAutomationConfidence(null).label).toMatch(/Not available/i);
  });
});

describe("hierarchy relationship drawer", () => {
  afterEach(() => cleanup());

  it("explains hierarchy edges as structure-only without Unknown health", () => {
    const hierarchyEdge: SelectedTopologyEdge = {
      id: "h1",
      kind: "hierarchy",
      sourceId: "portal",
      targetId: "app",
      sourceName: "Customer Portal",
      targetName: "Noble Express",
      status: "UNKNOWN",
      critical: false,
      colourMeaning: "Grey dashed — hierarchy or containment relationship (not traffic health).",
      writtenHealth: "Not applicable (containment)",
      colourReason: "Hierarchy/containment edges always render grey dashed — colour is not traffic health.",
      structureNote:
        "OpsWatch diagnoses traffic health on dependency lines; this line shows structure only.",
      endpointEvidence: [
        "Source (Customer Portal): Relationship discovery pending — OpsWatch has not mapped dependencies for this module yet."
      ]
    };
    const evaluation = evaluateRelationshipAutomation({ edge: hierarchyEdge, topology });
    render(
      <TopologyRelationshipDrawer
        edge={hierarchyEdge}
        topology={topology}
        projectId="proj-1"
        evaluation={evaluation}
        onClose={vi.fn()}
        onFixWithAutomation={vi.fn()}
      />
    );

    expect(screen.getByTestId("topology-edge-written-health")).toHaveTextContent(
      /Not applicable \(containment\)/
    );
    expect(screen.getByTestId("topology-edge-structure-note")).toHaveTextContent(/dependency lines/i);
    expect(screen.getByTestId("topology-hierarchy-traffic-note")).toHaveTextContent(/Not applicable/i);
    expect(screen.getByTestId("topology-edge-endpoint-evidence")).toHaveTextContent(/discovery pending/i);
    expect(evaluation.buttonState).toBe("no_automated_fix");
  });
});
