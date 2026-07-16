import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TopologyRelationshipDrawer,
  evaluateRelationshipAutomation,
  relationshipSetupHrefs
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

  it("renders an enabled Connect provider CTA linking to the remediator integration when setup is required", () => {
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

    const cta = screen.getByTestId("topology-fix-with-automation");
    expect(cta).toHaveAttribute("data-state", "setup_required");
    const href = cta.getAttribute("href") ?? "";
    expect(href).toContain("/projects/proj-1/integrations/worker_provider?");
    expect(href).toContain("returnTo=");
    expect(cta).toHaveTextContent("Connect provider");
    expect(cta.tagName).toBe("A");
    expect(cta).not.toBeDisabled();

    expect(screen.getByTestId("topology-setup-config-link")).toHaveAttribute(
      "href",
      "/projects/proj-1/settings"
    );
    expect(screen.getByTestId("topology-setup-connections-link").getAttribute("href") ?? "").toContain(
      "/connections?"
    );
    expect(screen.getByTestId("topology-setup-remediator-link").getAttribute("href") ?? "").toContain(
      "/integrations/worker_provider"
    );
    expect(screen.getByTestId("topology-setup-required-status")).toHaveTextContent(
      /Setup required — connect and validate a remediator/i
    );
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
  });
});

describe("evaluateRelationshipAutomation", () => {
  it("returns setup_required when no remediation capability exists", () => {
    expect(evaluateRelationshipAutomation({ edge }).buttonState).toBe("setup_required");
  });

  it("returns remediating when an active run targets the edge", () => {
    const result = evaluateRelationshipAutomation({
      edge,
      projectAutomationMode: "APPROVAL",
      hasRemediationCapability: true,
      activeRun: { id: "run-1", incidentId: "inc-1", status: "VERIFYING" }
    });
    expect(result.buttonState).toBe("remediating");
    expect(result.activeIncidentId).toBe("inc-1");
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
    const evaluation = evaluateRelationshipAutomation({ edge: hierarchyEdge });
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
