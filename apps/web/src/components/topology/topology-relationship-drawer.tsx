"use client";

import Link from "next/link";
import type { SelectedTopologyEdge } from "./topology-edge-style";
import type { ProjectTopologyResponse } from "./topology-types";
import { buildNodeRelationshipDiagnostics } from "./topology-relationship";
import {
  automationModeSettingsHref,
  relatedAlertsForEdge,
  topologyReturnPath
} from "./topology-automation-link";

export type AutomationButtonState =
  | "ready"
  | "approval_required"
  | "setup_required"
  | "observe_blocked"
  | "no_automated_fix"
  | "remediating";

export type AutomationExecutionBlockerId =
  | "observe_mode"
  | "no_remediator"
  | "missing_capability"
  | "awaiting_approval"
  | "emergency_disable";

export type AutomationExecutionBlocker = {
  id: AutomationExecutionBlockerId;
  label: string;
  active: boolean;
};

export type RelationshipAutomationEvidence = {
  summary: string;
  relatedAlertCount: number;
  failedCheckEndpoints: string[];
  openAlertCount: number;
  relationshipHealth: string;
  lastFailure: string | null;
  incidentMemoryOccurrences: number | null;
};

export type RelationshipIncidentMemory = {
  confidenceScore?: number | null;
  occurrenceCount?: number | null;
};

export type RelationshipAutomationEvaluation = {
  buttonState: AutomationButtonState;
  automationMode: "OBSERVE" | "APPROVAL" | "AUTONOMOUS";
  reason: string;
  proposedAction: string | null;
  requiredScope: string | null;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | null;
  riskExplanation: string | null;
  verificationMethod: string | null;
  rollbackMethod: string | null;
  confidenceScore: number | null;
  confidenceLabel: string;
  executionBlockers: AutomationExecutionBlocker[];
  evidence: RelationshipAutomationEvidence;
  policyAllowsModeChange: boolean;
  /** When remediating, link to the incident carrying the active run. */
  activeIncidentId?: string | null;
  activeRunId?: string | null;
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

export const buttonLabel = (state: AutomationButtonState): string => {
  if (state === "ready") return "Fix with automation";
  if (state === "approval_required") return "Request Approval";
  if (state === "setup_required") return "Connect Remediator to Enable Repair";
  if (state === "observe_blocked") return "Enable Autonomous Mode";
  if (state === "remediating") return "View repair in progress";
  return "No automated fix";
};

export const riskExplanationForAction = (
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | null,
  proposedAction: string | null,
  critical: boolean
): string | null => {
  if (!riskLevel || !proposedAction) return null;
  if (critical || riskLevel === "HIGH") {
    return "High — may interrupt live traffic or sync on a critical dependency edge.";
  }
  if (riskLevel === "MEDIUM") {
    if (/restart/i.test(proposedAction)) {
      return "Medium — worker restart may briefly interrupt sync or queued jobs.";
    }
    return "Medium — may cause a short service disruption while recovery runs.";
  }
  if (/retry/i.test(proposedAction)) {
    return "Low — retry is unlikely to disrupt healthy endpoints.";
  }
  if (/restart/i.test(proposedAction)) {
    return "Low — brief worker restart with minimal blast radius.";
  }
  return "Low — limited operational impact expected.";
};

export const resolveAutomationConfidence = (
  incidentMemory?: RelationshipIncidentMemory | null
): { score: number | null; label: string } => {
  const raw = incidentMemory?.confidenceScore;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const percent = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
    return { score: percent, label: `${percent}%` };
  }
  return {
    score: null,
    label: "Not available (insufficient learning data)"
  };
};

export const buildRelationshipEvidence = (
  edge: SelectedTopologyEdge,
  topology: ProjectTopologyResponse,
  incidentMemory?: RelationshipIncidentMemory | null
): RelationshipAutomationEvidence => {
  const alerts = relatedAlertsForEdge(topology, edge);
  const sourceCtx = topology.nodeContext[edge.sourceId];
  const targetCtx = topology.nodeContext[edge.targetId];
  const nodeById = new Map(topology.nodes.map((node) => [node.id, node]));

  const failedCheckEndpoints: string[] = [];
  for (const nodeId of [edge.sourceId, edge.targetId]) {
    const ctx = topology.nodeContext[nodeId];
    if (ctx?.lastCheckStatus === "FAIL") {
      failedCheckEndpoints.push(nodeById.get(nodeId)?.name ?? nodeId);
    }
  }

  const lastFailure =
    alerts[0]?.title ??
    (edge.status === "CRITICAL" || edge.status === "DEGRADED"
      ? targetCtx?.lastCheckAt ?? sourceCtx?.lastCheckAt ?? "Failure inferred from relationship health"
      : null);

  const occurrenceCount =
    typeof incidentMemory?.occurrenceCount === "number" && incidentMemory.occurrenceCount > 0
      ? incidentMemory.occurrenceCount
      : null;

  const hasRichSignals =
    alerts.length > 0 ||
    failedCheckEndpoints.length > 0 ||
    occurrenceCount != null ||
    edge.status === "CRITICAL" ||
    edge.status === "DEGRADED";

  const summary =
    occurrenceCount != null
      ? `${occurrenceCount} prior occurrence${occurrenceCount === 1 ? "" : "s"} recorded in incident memory.`
      : hasRichSignals
        ? "Monitoring signals from linked endpoints and relationship health."
        : "Limited evidence — monitoring signals only";

  return {
    summary,
    relatedAlertCount: alerts.length,
    failedCheckEndpoints,
    openAlertCount: alerts.length,
    relationshipHealth: edge.writtenHealth,
    lastFailure: lastFailure == null ? null : String(lastFailure),
    incidentMemoryOccurrences: occurrenceCount
  };
};

export const buildExecutionBlockers = (input: {
  buttonState: AutomationButtonState;
  automationMode: RelationshipAutomationEvaluation["automationMode"];
  hasRemediationCapability: boolean;
  hasConnectedRemediator: boolean;
  remediatorEmergencyDisabled: boolean;
}): AutomationExecutionBlocker[] => {
  const observeActive =
    input.automationMode === "OBSERVE" &&
    (input.buttonState === "observe_blocked" || input.buttonState === "no_automated_fix");
  const noRemediatorActive =
    !input.hasConnectedRemediator &&
    (input.buttonState === "setup_required" || input.buttonState === "no_automated_fix");
  const missingCapabilityActive =
    input.hasConnectedRemediator && !input.hasRemediationCapability && input.buttonState === "setup_required";
  const awaitingApprovalActive = input.buttonState === "approval_required";
  const emergencyActive = input.remediatorEmergencyDisabled;

  return [
    {
      id: "observe_mode",
      label: "Observe mode enabled",
      active: observeActive
    },
    {
      id: "no_remediator",
      label: "No remediator connected / not validated",
      active: noRemediatorActive
    },
    {
      id: "missing_capability",
      label: "Missing capability",
      active: missingCapabilityActive
    },
    {
      id: "awaiting_approval",
      label: "Awaiting approval",
      active: awaitingApprovalActive
    },
    {
      id: "emergency_disable",
      label: "Emergency disable",
      active: emergencyActive
    }
  ];
};

const MODE_BADGE: Record<
  RelationshipAutomationEvaluation["automationMode"],
  { label: string; tone: string; dotClass: string }
> = {
  OBSERVE: {
    label: "Observe",
    tone: "topology-mode-badge--observe",
    dotClass: "topology-mode-dot--observe"
  },
  APPROVAL: {
    label: "Approval Required",
    tone: "topology-mode-badge--approval",
    dotClass: "topology-mode-dot--approval"
  },
  AUTONOMOUS: {
    label: "Autonomous",
    tone: "topology-mode-badge--autonomous",
    dotClass: "topology-mode-dot--autonomous"
  }
};

export function AutomationModeBadge({
  mode
}: {
  mode: RelationshipAutomationEvaluation["automationMode"];
}) {
  const config = MODE_BADGE[mode];
  return (
    <span
      className={`topology-automation-mode-badge ${config.tone}`}
      data-testid="topology-automation-mode-badge"
      data-mode={mode}
    >
      <span className={`topology-mode-dot ${config.dotClass}`} aria-hidden="true" />
      <span>{config.label}</span>
    </span>
  );
}

/** Destinations for setup_required CTAs — remediator first, then connections + settings. */
export const relationshipSetupHrefs = (
  projectId: string,
  opts?: { edgeId?: string | null }
) => {
  const returnTo = topologyReturnPath(projectId, opts?.edgeId);
  const params = new URLSearchParams({ projectId, returnTo });
  if (opts?.edgeId) params.set("edgeId", opts.edgeId);
  const query = params.toString();
  return {
    configuration: `/projects/${projectId}/settings`,
    connections: `/connections?${query}`,
    remediator: `/projects/${projectId}/integrations/worker_provider?${query}`,
    automationMode: automationModeSettingsHref(projectId)
  };
};

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
  const relatedAlerts = relatedAlertsForEdge(topology, edge);
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
    buttonState === "ready" || buttonState === "approval_required" || buttonState === "remediating";
  const setupHrefs = relationshipSetupHrefs(projectId, { edgeId: edge.id });
  const evidence = evaluation?.evidence ?? buildRelationshipEvidence(edge, topology);

  const renderPrimaryCta = () => {
    if (buttonState === "setup_required") {
      return (
        <Link
          href={setupHrefs.remediator}
          className="primary-button"
          data-testid="topology-fix-with-automation"
          data-state={buttonState}
        >
          {buttonLabel(buttonState)}
        </Link>
      );
    }

    if (buttonState === "observe_blocked") {
      if (evaluation?.policyAllowsModeChange) {
        return (
          <Link
            href={setupHrefs.automationMode}
            className="primary-button"
            data-testid="topology-fix-with-automation"
            data-state={buttonState}
          >
            {buttonLabel(buttonState)}
          </Link>
        );
      }
      return (
        <p className="topology-observe-blocked-note" data-testid="topology-observe-blocked-note" role="status">
          Observe mode blocks execution. Organisation or project policy does not allow enabling autonomous
          repairs — contact an administrator to update auto-run policy.
        </p>
      );
    }

    if (buttonState === "remediating" && evaluation?.activeIncidentId) {
      return (
        <Link
          href={`/incidents/${evaluation.activeIncidentId}`}
          className="primary-button"
          data-testid="topology-fix-with-automation"
          data-state={buttonState}
        >
          {buttonLabel(buttonState)}
        </Link>
      );
    }

    if (buttonState === "no_automated_fix") {
      return (
        <p className="dashboard-subtle" data-testid="topology-no-automated-fix-note" role="status">
          {evaluation?.reason ?? "No automated repair is available for this relationship."}
        </p>
      );
    }

    return (
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
    );
  };

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
          <dt>Discovery confidence</dt>
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
            <div className="topology-automation-mode-row">
              <span className="dashboard-subtle">Mode</span>
              <AutomationModeBadge mode={evaluation.automationMode} />
            </div>
            <p data-testid="topology-automation-reason">{evaluation.reason}</p>

            <section className="topology-detail-subsection" data-testid="topology-automation-evidence">
              <h4>Evidence</h4>
              <p className="dashboard-subtle" data-testid="topology-evidence-summary">
                {evidence.summary}
              </p>
              <ul className="topology-evidence-list">
                <li>
                  Relationship health: <strong>{evidence.relationshipHealth}</strong>
                </li>
                <li>
                  Open alerts on endpoints: <strong>{evidence.openAlertCount}</strong>
                </li>
                <li>
                  Failed checks:{" "}
                  <strong>
                    {evidence.failedCheckEndpoints.length > 0
                      ? evidence.failedCheckEndpoints.join(", ")
                      : "None recorded"}
                  </strong>
                </li>
                <li>
                  Last failure:{" "}
                  <strong>
                    {evidence.lastFailure
                      ? evidence.lastFailure.includes("T")
                        ? new Date(evidence.lastFailure).toLocaleString()
                        : evidence.lastFailure
                      : "None observed"}
                  </strong>
                </li>
                {evidence.incidentMemoryOccurrences != null ? (
                  <li>
                    Incident memory:{" "}
                    <strong>
                      {evidence.incidentMemoryOccurrences} prior occurrence
                      {evidence.incidentMemoryOccurrences === 1 ? "" : "s"}
                    </strong>
                  </li>
                ) : null}
              </ul>
            </section>

            {evaluation.proposedAction ? (
              <dl className="topology-detail-grid">
                <div>
                  <dt>Proposed action</dt>
                  <dd>{evaluation.proposedAction}</dd>
                </div>
                <div>
                  <dt>Risk</dt>
                  <dd>
                    {evaluation.riskLevel ?? "—"}
                    {evaluation.riskExplanation ? (
                      <span className="topology-risk-explanation" data-testid="topology-risk-explanation">
                        {" "}
                        — {evaluation.riskExplanation}
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd data-testid="topology-automation-confidence">{evaluation.confidenceLabel}</dd>
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

            <section className="topology-detail-subsection" data-testid="topology-execution-blockers">
              <h4>Execution blockers</h4>
              <ul className="topology-blocker-checklist">
                {evaluation.executionBlockers.map((blocker) => (
                  <li
                    key={blocker.id}
                    data-testid={`topology-blocker-${blocker.id}`}
                    data-active={blocker.active ? "true" : "false"}
                    className={blocker.active ? "is-active" : undefined}
                  >
                    <span className="topology-blocker-mark" aria-hidden="true">
                      {blocker.active ? "✓" : "○"}
                    </span>
                    <span>{blocker.label}</span>
                  </li>
                ))}
              </ul>
            </section>

            {buttonState === "setup_required" ? (
              <p className="topology-setup-links">
                <span className="dashboard-subtle" data-testid="topology-setup-required-status">
                  Setup required — connect and validate a remediator provider that can restart or retry this
                  integration.
                </span>
                {" · "}
                <Link
                  href={setupHrefs.remediator}
                  data-testid="topology-setup-remediator-link"
                  className="topology-setup-link"
                >
                  Connect remediator
                </Link>
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

            {renderPrimaryCta()}

            {buttonState === "ready" || buttonState === "approval_required" ? (
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

/** Shared setup/no-action wording — keep aligned with alert automation evaluation. */
export const RELATIONSHIP_NO_REMEDIATOR_REASON =
  "Setup required — connect and validate a remediator provider that can restart or retry this integration.";

const PROPOSED_ACTION = "Restart dependency worker / retry integration";

const baseProposed = (riskLevel: "LOW" | "MEDIUM" | "HIGH", critical: boolean) => ({
  proposedAction: PROPOSED_ACTION,
  requiredScope: "remediation:execute",
  riskLevel,
  riskExplanation: riskExplanationForAction(riskLevel, PROPOSED_ACTION, critical),
  verificationMethod: "Confirm healthy dependency traffic for a stable recovery window",
  rollbackMethod: "Manual operator review — no automatic rollback without provider support"
});

/** Client-side evaluation until a relationship-scoped remediation connector is registered. */
export const evaluateRelationshipAutomation = (input: {
  edge: SelectedTopologyEdge;
  topology?: ProjectTopologyResponse;
  projectAutomationMode?: string | null;
  /** When true, a scoped remediator is registered and validated. Default: false. */
  hasRemediationCapability?: boolean;
  /** Connected remediator without required action capability. */
  hasConnectedRemediator?: boolean;
  remediatorEmergencyDisabled?: boolean;
  policyAllowsModeChange?: boolean;
  incidentMemory?: RelationshipIncidentMemory | null;
  /** Active remediating/verifying run for endpoints of this edge. */
  activeRun?: { id: string; incidentId: string; status: string } | null;
}): RelationshipAutomationEvaluation => {
  const modeRaw = (input.projectAutomationMode || "OBSERVE").toUpperCase();
  const automationMode =
    modeRaw === "AUTONOMOUS" || modeRaw === "APPROVAL" || modeRaw === "OBSERVE"
      ? (modeRaw as RelationshipAutomationEvaluation["automationMode"])
      : "OBSERVE";

  const hasRemediationCapability = input.hasRemediationCapability ?? false;
  const hasConnectedRemediator = input.hasConnectedRemediator ?? hasRemediationCapability;
  const remediatorEmergencyDisabled = input.remediatorEmergencyDisabled ?? false;
  const policyAllowsModeChange =
    input.policyAllowsModeChange !== false && !remediatorEmergencyDisabled;
  const confidence = resolveAutomationConfidence(input.incidentMemory);
  const evidence = input.topology
    ? buildRelationshipEvidence(input.edge, input.topology, input.incidentMemory)
    : buildRelationshipEvidence(
        input.edge,
        {
          project: { id: "unknown", name: "", status: "UNKNOWN" },
          generatedAt: new Date().toISOString(),
          nodes: [],
          edges: [],
          summary: {
            total: 0,
            healthy: 0,
            degraded: 0,
            critical: 0,
            unknown: 0,
            openAlerts: 0,
            openIncidents: 0
          },
          nodeContext: {}
        },
        input.incidentMemory
      );

  const withBlockers = (
    partial: Omit<
      RelationshipAutomationEvaluation,
      "executionBlockers" | "evidence" | "confidenceScore" | "confidenceLabel" | "policyAllowsModeChange"
    >
  ): RelationshipAutomationEvaluation => ({
    ...partial,
    confidenceScore: confidence.score,
    confidenceLabel: confidence.label,
    evidence,
    policyAllowsModeChange,
    executionBlockers: buildExecutionBlockers({
      buttonState: partial.buttonState,
      automationMode: partial.automationMode,
      hasRemediationCapability,
      hasConnectedRemediator,
      remediatorEmergencyDisabled
    })
  });

  if (input.edge.kind === "hierarchy") {
    return withBlockers({
      buttonState: "no_automated_fix",
      automationMode,
      reason:
        "Hierarchy lines represent containment. OpsWatch does not run automated repairs against hierarchy edges.",
      proposedAction: null,
      requiredScope: null,
      riskLevel: null,
      riskExplanation: null,
      verificationMethod: null,
      rollbackMethod: null
    });
  }

  if (input.activeRun) {
    return withBlockers({
      buttonState: "remediating",
      automationMode,
      reason: `Automated repair is ${input.activeRun.status.toLowerCase().replaceAll("_", " ")}. OpsWatch will verify recovery on this dependency after the run completes.`,
      proposedAction: "Repair in progress",
      requiredScope: "remediation:execute",
      riskLevel: null,
      riskExplanation: null,
      verificationMethod: "Dependency health after consecutive successful checks",
      rollbackMethod: null,
      activeIncidentId: input.activeRun.incidentId,
      activeRunId: input.activeRun.id
    });
  }

  if (input.edge.status === "HEALTHY") {
    return withBlockers({
      buttonState: "no_automated_fix",
      automationMode,
      reason: "This dependency is currently healthy. No repair is required.",
      proposedAction: null,
      requiredScope: null,
      riskLevel: null,
      riskExplanation: null,
      verificationMethod: null,
      rollbackMethod: null
    });
  }

  const riskLevel: "LOW" | "MEDIUM" | "HIGH" = input.edge.critical ? "HIGH" : "LOW";
  const proposed = baseProposed(riskLevel, input.edge.critical);

  if (remediatorEmergencyDisabled) {
    return withBlockers({
      buttonState: "no_automated_fix",
      automationMode,
      reason:
        "Emergency disable is active on the remediator — automated repair is blocked until an operator re-enables it.",
      ...proposed
    });
  }

  if (!hasRemediationCapability) {
    return withBlockers({
      buttonState: "setup_required",
      automationMode,
      reason: RELATIONSHIP_NO_REMEDIATOR_REASON,
      ...proposed
    });
  }

  if (automationMode === "OBSERVE") {
    return withBlockers({
      buttonState: "observe_blocked",
      automationMode,
      reason:
        "Observe mode: OpsWatch diagnosed a repair candidate but will not execute. Switch the application to Approval or Autonomous to request or run approved repairs.",
      ...proposed
    });
  }

  if (automationMode === "APPROVAL") {
    return withBlockers({
      buttonState: "approval_required",
      automationMode,
      reason: "Approval mode: an administrator must approve before OpsWatch runs this repair.",
      ...proposed
    });
  }

  // AUTONOMOUS — only previously approved low-risk actions execute without a new approval.
  if (riskLevel !== "LOW") {
    return withBlockers({
      buttonState: "approval_required",
      automationMode,
      reason:
        "Autonomous mode only auto-executes previously approved low-risk actions. This repair requires approval.",
      ...proposed
    });
  }

  return withBlockers({
    buttonState: "ready",
    automationMode,
    reason: "A supported, approved low-risk remediation action is ready to run.",
    ...proposed
  });
};
