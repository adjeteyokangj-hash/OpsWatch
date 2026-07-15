"use client";

import Link from "next/link";
import type { SelectedTopologyEdge } from "./topology-edge-style";
import type { ProjectTopologyResponse } from "./topology-types";
import { buildNodeRelationshipDiagnostics } from "./topology-relationship";

export type AutomationButtonState = "ready" | "approval_required" | "setup_required" | "no_automated_fix";

export type RelationshipAutomationEvaluation = {
  buttonState: AutomationButtonState;
  automationMode: "OBSERVE" | "APPROVAL" | "AUTONOMOUS";
  reason: string;
  proposedAction: string | null;
  requiredScope: string | null;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | null;
  verificationMethod: string | null;
  rollbackMethod: string | null;
};

type Props = {
  edge: SelectedTopologyEdge;
  topology: ProjectTopologyResponse;
  projectId: string;
  evaluation: RelationshipAutomationEvaluation | null;
  evaluating?: boolean;
  acting?: boolean;
  onClose: () => void;
  onFixWithAutomation: () => void;
};

const buttonLabel = (state: AutomationButtonState): string => {
  if (state === "ready") return "Fix with automation";
  if (state === "approval_required") return "Request approval to fix";
  if (state === "setup_required") return "Connect provider";
  return "No automated fix";
};

/** Destinations for setup_required CTAs — real app routes. */
export const relationshipSetupHrefs = (projectId: string) => ({
  configuration: `/projects/${projectId}/settings`,
  connections: "/connections"
});

export function TopologyRelationshipDrawer({
  edge,
  topology,
  projectId,
  evaluation,
  evaluating = false,
  acting = false,
  onClose,
  onFixWithAutomation
}: Props) {
  const relatedAlerts = Object.entries(topology.nodeContext)
    .filter(([nodeId]) => nodeId === edge.sourceId || nodeId === edge.targetId)
    .flatMap(([, context]) => context.openAlerts);
  const relatedIncidents = Object.entries(topology.nodeContext)
    .filter(([nodeId]) => nodeId === edge.sourceId || nodeId === edge.targetId)
    .flatMap(([, context]) => context.unresolvedIncidents);
  const sourceDiag = buildNodeRelationshipDiagnostics(topology).find((row) => row.moduleId === edge.sourceId);
  const targetDiag = buildNodeRelationshipDiagnostics(topology).find((row) => row.moduleId === edge.targetId);
  const sourceNode = topology.nodes.find((node) => node.id === edge.sourceId);
  const targetNode = topology.nodes.find((node) => node.id === edge.targetId);
  const sourceCtx = topology.nodeContext[edge.sourceId];
  const targetCtx = topology.nodeContext[edge.targetId];
  const responseTimeMs = targetNode?.metrics.latencyMs ?? sourceNode?.metrics.latencyMs ?? null;
  const errorRate = targetNode?.metrics.errorRatePercent ?? sourceNode?.metrics.errorRatePercent ?? null;
  const lastSuccess =
    [sourceCtx?.lastCheckAt, targetCtx?.lastCheckAt]
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
  const lastFailureLabel =
    relatedAlerts[0] != null
      ? relatedAlerts[0].title
      : edge.status === "CRITICAL" || edge.status === "DEGRADED"
        ? targetCtx?.lastCheckAt ?? sourceCtx?.lastCheckAt ?? "Failure inferred from relationship health"
        : null;
  const buttonState = evaluation?.buttonState ?? "no_automated_fix";
  const canClick =
    buttonState === "ready" || buttonState === "approval_required";
  const setupHrefs = relationshipSetupHrefs(projectId);

  return (
    <aside className="panel topology-relationship-drawer" data-testid="topology-relationship-drawer">
      <div className="topology-drawer-head">
        <div>
          <p className="dashboard-subtle">Relationship</p>
          <h2>
            {edge.sourceName} → {edge.targetName}
          </h2>
        </div>
        <button type="button" className="secondary-button" onClick={onClose} aria-label="Close relationship details">
          ×
        </button>
      </div>

      <dl className="topology-detail-grid">
        <div>
          <dt>Relationship ID</dt>
          <dd data-testid="topology-edge-id">
            <code>{edge.id}</code>
          </dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{edge.sourceName}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>{edge.targetName}</dd>
        </div>
        <div>
          <dt>Relationship type</dt>
          <dd>{edge.kind === "hierarchy" ? "Hierarchy / containment" : "Dependency / traffic"}</dd>
        </div>
        <div>
          <dt>Direction</dt>
          <dd>
            {edge.sourceName} → {edge.targetName}
          </dd>
        </div>
        <div>
          <dt>Health</dt>
          <dd data-testid="topology-edge-written-health">{edge.writtenHealth}</dd>
        </div>
        {edge.kind === "hierarchy" && edge.structureNote ? (
          <div>
            <dt>Diagnosis scope</dt>
            <dd data-testid="topology-edge-structure-note">{edge.structureNote}</dd>
          </div>
        ) : null}
        {edge.kind === "hierarchy" && (edge.endpointEvidence?.length ?? 0) > 0 ? (
          <div>
            <dt>Endpoint evidence</dt>
            <dd data-testid="topology-edge-endpoint-evidence">
              <ul className="topology-endpoint-evidence-list">
                {edge.endpointEvidence!.map((row) => (
                  <li key={row}>{row}</li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Line colour meaning</dt>
          <dd data-testid="topology-edge-colour-meaning">{edge.colourMeaning}</dd>
        </div>
        <div>
          <dt>Colour selection reason</dt>
          <dd data-testid="topology-edge-colour-reason">{edge.colourReason}</dd>
        </div>
        {edge.kind === "dependency" ? (
          <>
            <div>
              <dt>Response time</dt>
              <dd>{responseTimeMs == null ? "Not available" : `${responseTimeMs} ms`}</dd>
            </div>
            <div>
              <dt>Error rate</dt>
              <dd>{errorRate == null ? "Not available" : `${errorRate}%`}</dd>
            </div>
            <div>
              <dt>Throughput</dt>
              <dd>Not available</dd>
            </div>
            <div>
              <dt>Last successful communication</dt>
              <dd>{lastSuccess ? new Date(lastSuccess).toLocaleString() : "Not available"}</dd>
            </div>
            <div>
              <dt>Last failure</dt>
              <dd>
                {lastFailureLabel
                  ? typeof lastFailureLabel === "string" && lastFailureLabel.includes("T")
                    ? new Date(lastFailureLabel).toLocaleString()
                    : lastFailureLabel
                  : "None observed"}
              </dd>
            </div>
          </>
        ) : (
          <div>
            <dt>Traffic metrics</dt>
            <dd data-testid="topology-hierarchy-traffic-note">
              Not applicable on hierarchy lines — open a solid dependency relationship for traffic
              health, latency, and failures.
            </dd>
          </div>
        )}
        <div>
          <dt>Discovery source</dt>
          <dd>Declared</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>Confirmed</dd>
        </div>
        <div>
          <dt>Source connectivity</dt>
          <dd>{sourceDiag?.connectionState?.replaceAll("_", " ") ?? "—"}</dd>
        </div>
        <div>
          <dt>Target connectivity</dt>
          <dd>{targetDiag?.connectionState?.replaceAll("_", " ") ?? "—"}</dd>
        </div>
      </dl>

      <section className="topology-detail-section">
        <h3>Related alerts</h3>
        {relatedAlerts.length === 0 ? (
          <p className="dashboard-subtle">No open alerts on the endpoints of this relationship.</p>
        ) : (
          <ul>
            {relatedAlerts.map((alert) => (
              <li key={alert.id}>
                <Link href={`/alerts/${alert.id}`}>{alert.title}</Link> · {alert.severity} · {alert.status}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="topology-detail-section">
        <h3>Related incidents</h3>
        {relatedIncidents.length === 0 ? (
          <p className="dashboard-subtle">No unresolved incidents on these endpoints.</p>
        ) : (
          <ul>
            {relatedIncidents.map((incident) => (
              <li key={incident.id}>
                <Link href={`/incidents/${incident.id}`}>{incident.title}</Link> · {incident.severity}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="topology-detail-section" data-testid="topology-relationship-automation">
        <h3>Automation evaluation</h3>
        {evaluating ? <p className="dashboard-subtle">Evaluating automation…</p> : null}
        {evaluation ? (
          <>
            <p>
              <strong>Mode:</strong> {evaluation.automationMode}
            </p>
            <p data-testid="topology-automation-reason">{evaluation.reason}</p>
            {evaluation.proposedAction ? (
              <dl className="topology-detail-grid">
                <div>
                  <dt>Proposed action</dt>
                  <dd>{evaluation.proposedAction}</dd>
                </div>
                <div>
                  <dt>Risk</dt>
                  <dd>{evaluation.riskLevel ?? "—"}</dd>
                </div>
                <div>
                  <dt>Required scope</dt>
                  <dd>{evaluation.requiredScope ?? "—"}</dd>
                </div>
                <div>
                  <dt>Verification</dt>
                  <dd>{evaluation.verificationMethod ?? "—"}</dd>
                </div>
                <div>
                  <dt>Rollback</dt>
                  <dd>{evaluation.rollbackMethod ?? "—"}</dd>
                </div>
              </dl>
            ) : null}
            {buttonState === "setup_required" ? (
              <p className="topology-setup-links">
                <span className="dashboard-subtle" data-testid="topology-setup-required-status">
                  Setup required
                </span>
                {" · "}
                <Link
                  href={setupHrefs.configuration}
                  data-testid="topology-setup-config-link"
                  className="topology-setup-link"
                >
                  Open configuration
                </Link>
                {" · "}
                <Link
                  href={setupHrefs.connections}
                  data-testid="topology-setup-connections-link"
                  className="topology-setup-link"
                >
                  Open connections
                </Link>
              </p>
            ) : null}
            {buttonState === "setup_required" ? (
              <Link
                href={setupHrefs.connections}
                className="primary-button"
                data-testid="topology-fix-with-automation"
                data-state={buttonState}
              >
                {buttonLabel(buttonState)}
              </Link>
            ) : (
              <button
                type="button"
                className="primary-button"
                disabled={!canClick || acting}
                onClick={onFixWithAutomation}
                data-testid="topology-fix-with-automation"
                data-state={buttonState}
              >
                {acting ? "Working…" : buttonLabel(buttonState)}
              </button>
            )}
            {canClick ? (
              <p className="dashboard-subtle">Confirmation wording: “Run approved automated repair”</p>
            ) : null}
          </>
        ) : (
          <p className="dashboard-subtle">
            OpsWatch detected this relationship, but automation has not been evaluated yet.
          </p>
        )}
      </section>
    </aside>
  );
}

/** Client-side evaluation until a relationship-scoped remediation connector is registered. */
export const evaluateRelationshipAutomation = (input: {
  edge: SelectedTopologyEdge;
  projectAutomationMode?: string | null;
  /** When true, a scoped remediator is registered (tests / future connectors). Default: false. */
  hasRemediationCapability?: boolean;
}): RelationshipAutomationEvaluation => {
  const modeRaw = (input.projectAutomationMode || "OBSERVE").toUpperCase();
  const automationMode =
    modeRaw === "AUTONOMOUS" || modeRaw === "APPROVAL" || modeRaw === "OBSERVE"
      ? (modeRaw as RelationshipAutomationEvaluation["automationMode"])
      : "OBSERVE";

  if (input.edge.kind === "hierarchy") {
    return {
      buttonState: "no_automated_fix",
      automationMode,
      reason:
        "Hierarchy lines represent containment. OpsWatch does not run automated repairs against hierarchy edges.",
      proposedAction: null,
      requiredScope: null,
      riskLevel: null,
      verificationMethod: null,
      rollbackMethod: null
    };
  }

  if (input.edge.status === "HEALTHY") {
    return {
      buttonState: "no_automated_fix",
      automationMode,
      reason: "This dependency is currently healthy. No repair is required.",
      proposedAction: null,
      requiredScope: null,
      riskLevel: null,
      verificationMethod: null,
      rollbackMethod: null
    };
  }

  const riskLevel: "LOW" | "MEDIUM" | "HIGH" = input.edge.critical ? "HIGH" : "LOW";
  const proposed = {
    proposedAction: "Restart dependency worker / retry integration",
    requiredScope: "remediation:execute",
    riskLevel,
    verificationMethod: "Confirm healthy dependency traffic for a stable recovery window",
    rollbackMethod: "Manual operator review — no automatic rollback without provider support"
  };

  if (!input.hasRemediationCapability) {
    return {
      buttonState: "setup_required",
      automationMode,
      reason:
        "OpsWatch detected this problem, but no approved automated repair is configured for this dependency. Connect a provider with a scoped remediation action, then set organisation policy to Approval or Autonomous.",
      ...proposed
    };
  }

  if (automationMode === "OBSERVE") {
    return {
      buttonState: "no_automated_fix",
      automationMode,
      reason:
        "Observe mode: OpsWatch diagnosed a repair candidate but will not execute. Switch the application to Approval or Autonomous to request or run approved repairs.",
      ...proposed
    };
  }

  if (automationMode === "APPROVAL") {
    return {
      buttonState: "approval_required",
      automationMode,
      reason: "Approval mode: an administrator must approve before OpsWatch runs this repair.",
      ...proposed
    };
  }

  // AUTONOMOUS — only previously approved low-risk actions execute without a new approval.
  if (riskLevel !== "LOW") {
    return {
      buttonState: "approval_required",
      automationMode,
      reason:
        "Autonomous mode only auto-executes previously approved low-risk actions. This repair requires approval.",
      ...proposed
    };
  }

  return {
    buttonState: "ready",
    automationMode,
    reason: "A supported, approved low-risk remediation action is ready to run.",
    ...proposed
  };
};
