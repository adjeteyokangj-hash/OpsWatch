"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Shell } from "../../../components/layout/shell";
import { Header } from "../../../components/layout/header";
import { apiFetch } from "../../../lib/api";
import { IncidentHealthSummary } from "../../../components/incidents/incident-health-summary";
import { IncidentPropagationChain } from "../../../components/incidents/incident-propagation-chain";
import { IncidentLayerImpactPanel } from "../../../components/incidents/incident-layer-impact-panel";
import { IncidentDiagnosisEvidence } from "../../../components/incidents/incident-diagnosis-evidence";
import { HttpStatusReviewModal } from "../../../components/incidents/http-status-review-modal";
import { AutomationPlanPanel } from "../../../components/incidents/automation-plan-panel";
import { IncidentOrgCorrelationPanel } from "../../../components/incidents/incident-org-correlation-panel";
import { IncidentGraphView } from "../../../components/incidents/incident-graph-view";
import type { AutomationPlan, AutomationRunDetails } from "../../../components/incidents/automation-plan-types";
import type { DiagnosisResult, SuggestedAction } from "../../../components/incidents/incident-diagnosis-types";
type Incident = {
  id: string;
  title: string;
  severity: string;
  status: string;
  openedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  rootCause: string | null;
  resolutionNotes: string | null;
  project?: { id: string; name: string };
  alerts?: Array<{
    id: string;
    title: string;
    severity: string;
    status: string;
    lastSeenAt: string;
    service: { id: string; name: string } | null;
  }>;
  otelEvidence?: Array<{
    id: string;
    evidenceKind: string;
    summary: string;
    confidence: number | null;
    traceId: string | null;
    spanId: string | null;
    propagationDirection: string | null;
    candidateRootCause: boolean;
    observedAt: string;
  }>;
  correlationGroup?: {
    id: string;
    correlationKey: string;
    rootCauseSummary: string | null;
    primaryIncidentId: string | null;
    relatedIncidents: Array<{
      id: string;
      title: string;
      severity: string;
      status: string;
      project: { id: string; name: string };
    }>;
  } | null;
};

type RemediationResult = {
  action: string;
  logId: string;
  result: {
    success: boolean;
    status: "COMPLETED" | "FAILED" | "PENDING_APPROVAL" | "UNSUPPORTED" | "MISSING_CONTEXT" | "MISCONFIGURED_ENV";
    summary: string;
    details?: Record<string, unknown>;
    missingFields?: string[];
    missingEnvVars?: string[];
  };
};

type IncidentTimelineEvent = {
  id: string;
  eventType: string;
  summary: string;
  sourceType: string | null;
  sourceId: string | null;
  severity: string | null;
  occurredAt: string;
};

type RootCauseCandidate = {
  kind: "CHANGE_EVENT" | "DEPENDENCY" | "ALERT_SIGNAL";
  referenceId: string;
  title: string;
  score: number;
  confidenceLabel?: "POSSIBLE" | "PROBABLE" | "CONFIRMED";
  rationale: string;
  evidenceSummary?: string[];
  alternativeCauses?: string[];
  metadata: Record<string, unknown>;
};

type IncidentIntelligence = {
  signalLayer: "SIGNAL" | "ALERT" | "CORRELATED_INCIDENT";
  fingerprint: string;
  mergedIntoIncidentId: string | null;
  mergedFromCount: number;
  reopenCount: number;
  alertCount: number;
  evidenceOnly: boolean;
  topCandidate: RootCauseCandidate | null;
};

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: "severity critical",
  HIGH: "severity high",
  MEDIUM: "severity medium",
  LOW: "severity",
  INFO: "severity",
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Open",
  INVESTIGATING: "Investigating",
  MONITORING: "Monitoring",
  RESOLVED: "Resolved",
};

const statusRank = (status: string): number => {
  if (status === "OPEN") return 0;
  if (status === "INVESTIGATING") return 1;
  if (status === "MONITORING") return 2;
  return 3;
};

export default function IncidentDetailPage() {
  const params = useParams<{ incidentId: string }>();
  const incidentId = params?.incidentId ?? "";

  const [incident, setIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);

  const [executing, setExecuting] = useState<string | null>(null);
  const [actionResults, setActionResults] = useState<Record<string, RemediationResult>>({});

  const [status, setStatus] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<IncidentTimelineEvent[]>([]);
  const [rootCauseCandidates, setRootCauseCandidates] = useState<RootCauseCandidate[]>([]);
  const [intelligence, setIntelligence] = useState<IncidentIntelligence | null>(null);
  const [reopening, setReopening] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [autoHealing, setAutoHealing] = useState(false);
  const [autoHealMessage, setAutoHealMessage] = useState<string | null>(null);
  const [httpReviewAction, setHttpReviewAction] = useState<SuggestedAction | null>(null);
  const [automationPlan, setAutomationPlan] = useState<AutomationPlan | null>(null);
  const [automationRun, setAutomationRun] = useState<AutomationRunDetails | null>(null);
  const [canApproveAutomation, setCanApproveAutomation] = useState(false);
  const [planningAutomation, setPlanningAutomation] = useState(false);
  const [automationActing, setAutomationActing] = useState(false);
  const [automationPlanError, setAutomationPlanError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "timeline" | "graph" | "automation">("overview");

  const runDiagnosis = useCallback(async () => {
    if (!incident) return;
    setDiagnosing(true);
    try {
      const result = await apiFetch<DiagnosisResult>("/remediation/suggest", {
        method: "POST",
        body: JSON.stringify({
          incidentId: incident.id,
          title: incident.title,
          severity: incident.severity,
        }),
      });
      setDiagnosis(result);
    } finally {
      setDiagnosing(false);
    }
  }, [incident]);
  useEffect(() => {
    if (!incidentId) return;

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [inc, timelineRows, candidateRows, intelligenceRow] = await Promise.all([
          apiFetch<Incident>(`/incidents/${incidentId}`),
          apiFetch<IncidentTimelineEvent[]>(`/incidents/${incidentId}/timeline`),
          apiFetch<RootCauseCandidate[]>(`/incidents/${incidentId}/root-cause-candidates`),
          apiFetch<IncidentIntelligence>(`/incidents/${incidentId}/intelligence`).catch(() => null)
        ]);
        setIncident(inc);
        setStatus(inc.status);
        setRootCause(inc.rootCause ?? "");
        setTimeline(Array.isArray(timelineRows) ? timelineRows : []);
        setRootCauseCandidates(Array.isArray(candidateRows) ? candidateRows : []);
        setIntelligence(intelligenceRow);
        setAnalysisError(null);
      } catch (err: any) {
        setLoadError(err?.message || "Failed to load incident");
        setAnalysisError(err?.message || "Failed to load timeline and root-cause analysis");
        setIncident(null);
        setTimeline([]);
        setRootCauseCandidates([]);
        setIntelligence(null);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [incidentId]);

  useEffect(() => {
    if (!incident || diagnosis || diagnosing) return;
    void runDiagnosis();
  }, [incident, diagnosis, diagnosing, runDiagnosis]);

  const refreshAutomationRun = useCallback(async (runId: string) => {
    const run = await apiFetch<AutomationRunDetails & { permissions?: { canApprove: boolean } }>(
      `/automation/runs/${runId}`
    );
    setAutomationRun(run);
    setCanApproveAutomation(Boolean(run.permissions?.canApprove));
  }, []);

  const generateAutomationPlan = useCallback(async () => {
    if (!incident) return;
    setPlanningAutomation(true);
    setAutomationPlanError(null);
    try {
      const response = await apiFetch<
        AutomationPlan & { permissions?: { canApprove: boolean }; status?: string }
      >(`/automation/incidents/${incident.id}/plan`, {
        method: "POST"
      });
      setAutomationPlan(response);
      setCanApproveAutomation(Boolean(response.permissions?.canApprove));
      if (response.runId) {
        await refreshAutomationRun(response.runId);
      }
    } catch (err: any) {
      setAutomationPlanError(err?.message || "Failed to generate automation plan");
    } finally {
      setPlanningAutomation(false);
    }
  }, [incident, refreshAutomationRun]);

  const approveAutomationPlan = useCallback(
    async (reason: string) => {
      if (!automationPlan?.runId) return;
      setAutomationActing(true);
      setAutomationPlanError(null);
      try {
        await apiFetch(`/automation/runs/${automationPlan.runId}/approve`, {
          method: "POST",
          body: JSON.stringify({ approved: true, reason })
        });
        await refreshAutomationRun(automationPlan.runId);
      } catch (err: any) {
        setAutomationPlanError(err?.message || "Failed to approve automation plan");
      } finally {
        setAutomationActing(false);
      }
    },
    [automationPlan?.runId, refreshAutomationRun]
  );

  const rejectAutomationPlan = useCallback(
    async (reason: string) => {
      if (!automationPlan?.runId) return;
      setAutomationActing(true);
      setAutomationPlanError(null);
      try {
        await apiFetch(`/automation/runs/${automationPlan.runId}/reject`, {
          method: "POST",
          body: JSON.stringify({ reason })
        });
        await refreshAutomationRun(automationPlan.runId);
      } catch (err: any) {
        setAutomationPlanError(err?.message || "Failed to reject automation plan");
      } finally {
        setAutomationActing(false);
      }
    },
    [automationPlan?.runId, refreshAutomationRun]
  );

  const cancelAutomationPlan = useCallback(async () => {
    if (!automationPlan?.runId) return;
    setAutomationActing(true);
    setAutomationPlanError(null);
    try {
      await apiFetch(`/automation/runs/${automationPlan.runId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: "Cancelled from incident page" })
      });
      await refreshAutomationRun(automationPlan.runId);
    } catch (err: any) {
      setAutomationPlanError(err?.message || "Failed to cancel automation plan");
    } finally {
      setAutomationActing(false);
    }
  }, [automationPlan?.runId, refreshAutomationRun]);

  useEffect(() => {
    // Stop after a failed attempt — otherwise 404/denied planning loops forever on "Planning…".
    if (!incident || !diagnosis || automationPlan || planningAutomation || automationPlanError) return;
    void generateAutomationPlan();
  }, [
    incident,
    diagnosis,
    automationPlan,
    planningAutomation,
    automationPlanError,
    generateAutomationPlan
  ]);

  const triggerAutoHeal = async () => {
    if (!incident) return;
    setAutoHealing(true);
    setAutoHealMessage(null);
    try {
      const result = await apiFetch<{ attempted: boolean; summary?: string; blockedReason?: string; action?: string }>(
        `/remediation/${incident.id}/auto-run`,
        { method: "POST" }
      );
      if (result.attempted) {
        setAutoHealMessage(`Auto-heal ran ${result.action}: ${result.summary ?? "completed"}`);
      } else {
        setAutoHealMessage(result.blockedReason ?? "Auto-heal did not run");
      }
      await runDiagnosis();
    } catch (err: any) {
      setAutoHealMessage(err?.message || "Auto-heal request failed");
    } finally {
      setAutoHealing(false);
    }
  };

  const executeAction = async (action: string, requiresApproval: boolean, extra?: Record<string, unknown>) => {
    if (!incident) return;
    if (action === "REVIEW_HTTP_EXPECTED_STATUS") {
      const selected = diagnosis?.suggestedActions.find((row) => row.action === action);
      if (selected) {
        setHttpReviewAction(selected);
      }
      return;
    }

    const shouldRequestApproval = requiresApproval
      ? window.confirm(
          "This action requires approval. Confirm you want to submit it for approval?"
        )
      : true;
    if (!shouldRequestApproval) return;

    setExecuting(action);
    try {
      const leadServiceId = incident.alerts?.[0]?.service?.id;
      const result = await apiFetch<RemediationResult>("/remediation/execute", {
        method: "POST",
        body: JSON.stringify({
          action,
          context: {
            incidentId: incident.id,
            serviceId: leadServiceId,
            extra,
          },
          approved: requiresApproval,
        }),
      });
      setActionResults((prev) => ({ ...prev, [action]: result }));
    } finally {
      setExecuting(null);
    }
  };

  const submitHttpStatusReview = async (input: {
    newExpectedStatusCode: number;
    approvalReason: string;
  }) => {
    if (!incident || !httpReviewAction) return;
    const preview = httpReviewAction.preview ?? {};
    const checkId = typeof preview.checkId === "string" ? preview.checkId : undefined;
    const serviceId = incident.alerts?.[0]?.service?.id;

    setExecuting("REVIEW_HTTP_EXPECTED_STATUS");
    try {
      const result = await apiFetch<RemediationResult>("/remediation/execute", {
        method: "POST",
        body: JSON.stringify({
          action: "REVIEW_HTTP_EXPECTED_STATUS",
          context: {
            incidentId: incident.id,
            serviceId,
            checkId,
            extra: {
              newExpectedStatusCode: input.newExpectedStatusCode,
              approvalReason: input.approvalReason,
              actualStatusCode: preview.recentActualStatus,
            },
          },
          approved: true,
        }),
      });
      setActionResults((prev) => ({ ...prev, REVIEW_HTTP_EXPECTED_STATUS: result }));
      await runDiagnosis();
    } finally {
      setExecuting(null);
    }
  };
  const saveIncident = async (nextStatus?: string) => {
    if (!incident) return;
    const statusToSave = nextStatus ?? status;
    setSaving(true);
    setSaveMsg(null);
    try {
      await apiFetch(`/incidents/${incident.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: statusToSave, rootCause: rootCause || null }),
      });
      setStatus(statusToSave);
      setIncident((prev) => (prev ? { ...prev, status: statusToSave } : prev));
      setSaveMsg(
        statusToSave === "RESOLVED"
          ? "Incident resolved"
          : statusToSave === "OPEN"
            ? "Incident reopened"
            : statusToSave === "INVESTIGATING"
              ? "Marked investigating (acknowledged)"
              : "Saved"
      );
    } catch {
      setSaveMsg("Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Shell>
        <Header title="Incident" />
        <p className="content">Loading…</p>
      </Shell>
    );
  }

  if (!incident) {
    return (
      <Shell>
        <Header title="Incident" />
        {loadError ? <section className="panel error-panel">{loadError}</section> : null}
        <section className="panel">Incident not found.</section>
      </Shell>
    );
  }

  const confidencePct = diagnosis ? Math.round(diagnosis.confidence * 100) : 0;
  const sortedAlerts = [...(incident.alerts ?? [])].sort((a, b) => {
    const byStatus = statusRank(a.status) - statusRank(b.status);
    if (byStatus !== 0) return byStatus;
    return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
  });
  const unresolvedAlertCount = sortedAlerts.filter((alert) => alert.status !== "RESOLVED").length;

  return (
    <Shell>
      <Header title={incident.title} />

      {/* ── Meta strip ─────────────────────────────────────────────── */}
      <section className="panel">
        <div className="two-col">
          <div>
            <p className="metric-label">Severity</p>
            <span className={SEVERITY_STYLES[incident.severity] ?? "severity"}>
              {incident.severity}
            </span>
          </div>
          <div>
            <p className="metric-label">Status</p>
            <span className="pill">{STATUS_LABEL[incident.status] ?? incident.status}</span>
          </div>
          <div>
            <p className="metric-label">Opened</p>
            <p>{new Date(incident.openedAt).toLocaleString()}</p>
          </div>
          {incident.resolvedAt && (
            <div>
              <p className="metric-label">Resolved</p>
              <p>{new Date(incident.resolvedAt).toLocaleString()}</p>
            </div>
          )}
        </div>
      </section>

      {incident.correlationGroup ? (
        <IncidentOrgCorrelationPanel
          correlationGroup={incident.correlationGroup}
          currentIncidentId={incident.id}
        />
      ) : null}

      <section className="panel">
        <nav className="pill-row" aria-label="Incident views">
          {(
            [
              ["overview", "Overview"],
              ["timeline", "Timeline"],
              ["graph", "Graph view"],
              ["automation", "Automation"]
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`pill${activeTab === id ? " active" : ""}`}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </section>

      {activeTab === "graph" ? (
        <IncidentGraphView incidentId={incident.id} projectId={incident.project?.id} />
      ) : null}

      {activeTab === "automation" ? (
        <AutomationPlanPanel
          plan={automationPlan}
          run={automationRun}
          loading={planningAutomation}
          acting={automationActing}
          error={automationPlanError}
          canApprove={canApproveAutomation}
          onGenerate={() => void generateAutomationPlan()}
          onApprove={(reason) => void approveAutomationPlan(reason)}
          onReject={(reason) => void rejectAutomationPlan(reason)}
          onCancel={() => void cancelAutomationPlan()}
        />
      ) : null}

      {activeTab === "overview" ? (
        <>
      {diagnosing && !diagnosis ? (
        <section className="panel">
          <p className="content">Analysing incident impact and dependency graph…</p>
        </section>
      ) : null}

      {diagnosis ? (
        <>
          <IncidentHealthSummary
            projectName={incident.project?.name ?? "Application"}
            diagnosis={diagnosis}
          />
          <IncidentPropagationChain
            diagnosis={diagnosis}
            projectId={incident.project?.id}
          />
          {diagnosis.layerImpacts && diagnosis.layerImpacts.length > 0 ? (
            <IncidentLayerImpactPanel
              layerImpacts={diagnosis.layerImpacts}
              projectId={incident.project?.id}
            />
          ) : null}
          <IncidentDiagnosisEvidence diagnosis={diagnosis} />
        </>
      ) : null}

      <section className="panel">
        <h2>Operational context</h2>        <div className="two-col">
          <div>
            <p className="metric-label">Project</p>
            <p>
              {incident.project?.id ? (
                <Link href={`/projects/${incident.project.id}`}>{incident.project.name}</Link>
              ) : (
                "-"
              )}
            </p>
          </div>
          <div>
            <p className="metric-label">Linked alerts</p>
            <p>{sortedAlerts.length}</p>
          </div>
          <div>
            <p className="metric-label">Unresolved linked alerts</p>
            <p>{unresolvedAlertCount}</p>
          </div>
          <div>
            <p className="metric-label">Acknowledged</p>
            <p>{incident.acknowledgedAt ? new Date(incident.acknowledgedAt).toLocaleString() : "-"}</p>
          </div>
        </div>
        <p style={{ marginTop: "10px" }}>
          <strong>Root cause:</strong> {incident.rootCause || "Not captured yet."}
        </p>
        {incident.resolutionNotes ? (
          <p>
            <strong>Resolution notes:</strong> {incident.resolutionNotes}
          </p>
        ) : null}
      </section>

      <section className="panel">
        <h2>Linked alerts</h2>
        {sortedAlerts.length === 0 ? (
          <p className="dashboard-subtle">No alerts are currently linked to this incident.</p>
        ) : (
          <div className="dashboard-list">
            {sortedAlerts.map((alert) => (
              <article key={alert.id} className="dashboard-item" style={{ marginBottom: "8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center" }}>
                  <div>
                    <Link href={`/alerts/${alert.id}`}>{alert.title}</Link>
                    <div className="dashboard-subtle">
                      {alert.service?.id ? <Link href={`/checks?serviceId=${alert.service.id}`}>{alert.service.name}</Link> : "No service"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <span className={`severity ${alert.severity.toLowerCase()}`}>{alert.severity}</span>
                    <span className={`result-pill ${alert.status === "RESOLVED" ? "pass" : alert.status === "OPEN" ? "fail" : "warn"}`}>{alert.status}</span>
                  </div>
                </div>
                <div className="dashboard-subtle">Last seen {new Date(alert.lastSeenAt).toLocaleString()}</div>
              </article>
            ))}
          </div>
        )}
      </section>

      {incident.otelEvidence && incident.otelEvidence.length > 0 ? (
        <section className="panel" data-testid="otel-incident-evidence">
          <h2>OTEL evidence</h2>
          <ul className="dashboard-list">
            {incident.otelEvidence.map((row) => (
              <li key={row.id}>
                <strong>{row.evidenceKind}</strong> — {row.summary}
                <div className="dashboard-subtle">
                  {row.candidateRootCause ? "candidate root cause · " : ""}
                  {row.propagationDirection ? `${row.propagationDirection} · ` : ""}
                  {row.traceId ? `trace ${row.traceId.slice(0, 8)}… · ` : ""}
                  {row.confidence != null ? `confidence ${row.confidence} · ` : ""}
                  {new Date(row.observedAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Remediation actions ─────────────────────────────────────── */}
      <section className="panel ai-insight-panel">
        <div className="section-head">
          <div>
            <h2>Recommended actions</h2>
            <p>Safe automatic fixes, approval-gated changes, and support actions for this incident.</p>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              className="secondary-button"
              onClick={runDiagnosis}
              disabled={diagnosing}
            >
              {diagnosing ? "Refreshing…" : "Refresh diagnosis"}
            </button>
            <button
              className="secondary-button"
              onClick={triggerAutoHeal}
              disabled={autoHealing || incident.status === "RESOLVED"}
            >
              {autoHealing ? "Auto-healing…" : "Trigger auto-heal"}
            </button>
          </div>
        </div>

        {autoHealMessage ? <p className="dashboard-subtle">{autoHealMessage}</p> : null}

        {diagnosis && (
          <div className="ai-insight-body">
            <div className="ai-diagnosis">
              <p className="ai-diagnosis-text">{diagnosis.diagnosis}</p>
              <div className="ai-meta">
                <span className="ai-confidence-label">
                  Confidence: {confidencePct}%
                </span>
                <div
                  className="usage-bar-track ai-confidence-bar"
                  style={{ "--confidence": `${confidencePct}%` } as React.CSSProperties}
                >
                  <div className="usage-bar-fill ai-confidence-fill" />
                </div>
                <span className="ai-category pill">{diagnosis.category.replace("_", " ")}</span>
                {diagnosis.analysisMode ? (
                  <span className="pill">{diagnosis.analysisMode.toLowerCase()} analysis</span>
                ) : null}
                {diagnosis.failureClass ? (
                  <span className="pill">{diagnosis.failureClass.replace(/_/g, " ").toLowerCase()}</span>
                ) : null}
              </div>
              {diagnosis.possibleCauses && diagnosis.possibleCauses.length > 0 ? (
                <div className="dashboard-list" style={{ marginTop: "12px" }}>
                  <p className="metric-label">Possible causes</p>
                  {diagnosis.possibleCauses.map((cause) => (
                    <article key={cause} className="dashboard-item">
                      <div>{cause}</div>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
            {diagnosis.suggestedActions.length > 0 && (
              <div className="ai-actions">
                <p className="metric-label ai-actions-label">
                  Suggested actions
                </p>
                <div className="ai-action-list">
                  {diagnosis.suggestedActions.map((sa) => {
                    const res = actionResults[sa.action];
                    const isBlocked =
                      sa.state === "UNSUPPORTED" ||
                      sa.state === "MISSING_CONTEXT" ||
                      sa.state === "MISCONFIGURED_ENV";
                    return (
                      <div key={sa.action} className="ai-action-card">
                        <div className="ai-action-head">
                          <strong>{sa.label}</strong>
                          {sa.state === "READY" ? (
                            <span className="result-pill pass">Ready</span>
                          ) : sa.state === "APPROVAL_REQUIRED" ? (
                            <span className="result-pill warn">Requires approval</span>
                          ) : sa.state === "MISSING_CONTEXT" ? (
                            <span className="result-pill pending">Missing context</span>
                          ) : sa.state === "MISCONFIGURED_ENV" ? (
                            <span className="result-pill warn">Not configured</span>
                          ) : (
                            <span className="result-pill pending">Unsupported</span>
                          )}
                        </div>
                        <p className="ai-action-desc">{sa.description}</p>

                        {/* ── Suppression callout ────────────────────── */}
                        {sa.suppressionInfo?.suppressed && (
                          <div className={`suppression-callout ${sa.suppressionInfo.blocked ? "suppression-blocked" : "suppression-warn"}`}>
                            <span className="suppression-icon">{sa.suppressionInfo.blocked ? "⛔" : "⚠"}</span>
                            <div className="suppression-body">
                              <p className="suppression-title">
                                {sa.suppressionInfo.blocked
                                  ? "Auto-run blocked — unreliable action"
                                  : "Auto-run disabled — recent low reliability"}
                              </p>
                              <p className="suppression-detail">
                                {sa.suppressionInfo.recentFailed} failures in last {sa.suppressionInfo.windowSize} runs
                                {" "}({Math.round(sa.suppressionInfo.recentFailureRate * 100)}% failure rate)
                              </p>
                            </div>
                          </div>
                        )}

                        <div className="ai-action-badges">
                          <span className={`confidence-badge ${sa.confidenceLabel.toLowerCase()}`}>
                            {sa.confidenceLabel} {sa.confidenceScore}%
                          </span>
                          <span className={`policy-tier-badge ${
                            sa.policyTier === "SAFE_AUTOMATIC" ? "safe" :
                            sa.policyTier === "APPROVAL_REQUIRED" ? "approval" :
                            "manual"
                          }`}>
                            {sa.policyTier.replace(/_/g, " ")}
                          </span>
                          <span className={`impact-tier-badge impact-tier-${sa.impactTier.toLowerCase()}`}>
                            {sa.impactTier} impact
                          </span>
                          {sa.autoRunEligible && (
                            <span className="auto-run-indicator">
                              ✓ Auto-eligible
                            </span>
                          )}
                        </div>
                        <div className="confidence-factors">
                          <p className="factors-label">Confidence breakdown:</p>
                          <ul className="factors-list">
                            {sa.confidenceFactors.map((factor, idx) => (
                              <li key={idx} className={`factor-item factor-${factor.status}`}>
                                <span className="factor-name">{factor.name}</span>
                                <span className="factor-impact">{factor.impact > 0 ? '+' : ''}{factor.impact}</span>
                                <span className="factor-desc">{factor.description}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <p className="table-subtle">{sa.kind === "support" ? "Support action" : "Fix action"}</p>
                        {sa.state === "MISSING_CONTEXT" && sa.missingFields && sa.missingFields.length > 0 && (
                          <p className="table-subtle" style={{ color: "var(--color-warn, #b45309)" }}>
                            Missing: {sa.missingFields.join(", ")}
                          </p>
                        )}
                        {sa.state === "MISCONFIGURED_ENV" && sa.missingEnvVars && sa.missingEnvVars.length > 0 && (
                          <p className="table-subtle" style={{ color: "var(--color-warn, #b45309)" }}>
                            Env not set: {sa.missingEnvVars.join(", ")}
                          </p>
                        )}
                        {res ? (
                          <p
                            className={`ai-action-result ${
                              res.result.status === "COMPLETED"
                                ? "result-pill pass"
                                : res.result.status === "PENDING_APPROVAL"
                                ? "result-pill warn"
                                : res.result.status === "MISSING_CONTEXT"
                                ? "result-pill pending"
                                : res.result.status === "MISCONFIGURED_ENV"
                                ? "result-pill warn"
                                : res.result.status === "UNSUPPORTED"
                                ? "result-pill pending"
                                : "result-pill fail"
                            }`}
                          >
                            {res.result.status === "PENDING_APPROVAL"
                              ? "⏳ Pending approval"
                              : res.result.status === "COMPLETED"
                              ? `✓ ${res.result.summary}`
                              : res.result.status === "MISSING_CONTEXT"
                              ? `⚠ Missing: ${(res.result.missingFields ?? []).join(", ") || res.result.summary}`
                              : res.result.status === "MISCONFIGURED_ENV"
                              ? `⚙ Not configured: ${(res.result.missingEnvVars ?? []).join(", ") || res.result.summary}`
                              : res.result.status === "UNSUPPORTED"
                              ? `⊘ ${res.result.summary}`
                              : `✗ ${res.result.summary}`}
                          </p>
                        ) : (
                          <button
                            className="primary-button ai-action-btn"
                            data-action="api"
                            data-endpoint="/remediation/execute"
                            disabled={executing === sa.action || isBlocked}
                            onClick={() => executeAction(sa.action, sa.requiresApproval)}
                          >
                            {executing === sa.action
                              ? "Running…"
                              : sa.action === "REVIEW_HTTP_EXPECTED_STATUS"
                              ? "Review and approve"
                              : sa.state === "UNSUPPORTED"
                              ? "Not available"
                              : sa.state === "MISSING_CONTEXT"
                              ? "Context missing"
                              : sa.state === "MISCONFIGURED_ENV"
                              ? "Not configured"
                              : !sa.requiresApproval
                              ? "Apply fix"
                              : "Request approval"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {diagnosis.suggestedActions.length === 0 && (
              <p className="metric-label">No automated actions available for this incident type.</p>
            )}
          </div>
        )}

        {!diagnosis && !diagnosing ? (
          <p className="metric-label">Diagnosis has not loaded yet.</p>
        ) : null}
      </section>

      {httpReviewAction ? (
        <HttpStatusReviewModal
          action={httpReviewAction}
          incidentId={incident.id}
          serviceId={incident.alerts?.[0]?.service?.id}
          checkId={
            typeof httpReviewAction.preview?.checkId === "string"
              ? httpReviewAction.preview.checkId
              : undefined
          }
          onClose={() => setHttpReviewAction(null)}
          onSubmit={submitHttpStatusReview}
        />
      ) : null}

      {/* ── Update incident ────────────────────────────────────────── */}
      <section className="panel">
        <h2>Update incident</h2>
        <div className="incident-status-actions" role="group" aria-label="Incident status actions">
          {incident.status === "OPEN" ? (
            <button
              type="button"
              className="primary-button"
              disabled={saving}
              onClick={() => void saveIncident("INVESTIGATING")}
              title="Sets status to Investigating and records acknowledged time"
            >
              Acknowledge / investigate
            </button>
          ) : null}
          {incident.status === "INVESTIGATING" || incident.status === "MONITORING" ? (
            <button
              type="button"
              className="primary-button"
              disabled={saving}
              onClick={() => void saveIncident("RESOLVED")}
            >
              Resolve
            </button>
          ) : null}
          {incident.status === "RESOLVED" ? (
            <button
              type="button"
              className="secondary-button"
              disabled={saving || reopening}
              onClick={() => {
                if (!window.confirm("Reopen this incident? Cooldown rules still apply.")) return;
                void (async () => {
                  setReopening(true);
                  setSaveMsg(null);
                  try {
                    await apiFetch(`/incidents/${incident.id}/reopen`, { method: "POST", body: "{}" });
                    setStatus("OPEN");
                    setIncident({ ...incident, status: "OPEN", resolvedAt: null });
                    setSaveMsg("Incident reopened");
                  } catch (err: any) {
                    setSaveMsg(err?.message || "Could not reopen incident");
                  } finally {
                    setReopening(false);
                  }
                })();
              }}
            >
              {reopening ? "Reopening…" : "Reopen"}
            </button>
          ) : null}
          {incident.status !== "RESOLVED" && incident.status !== "OPEN" ? (
            <button
              type="button"
              className="secondary-button"
              disabled={saving}
              onClick={() => void saveIncident("MONITORING")}
            >
              Mark monitoring
            </button>
          ) : null}
        </div>
        <div className="stack-form incident-update-form" style={{ marginTop: "12px" }}>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="OPEN">Open</option>
              <option value="INVESTIGATING">Investigating</option>
              <option value="MONITORING">Monitoring</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </label>
          <label>
            Root cause
            <input
              value={rootCause}
              onChange={(e) => setRootCause(e.target.value)}
              placeholder="Describe the root cause…"
            />
          </label>
          <button
            type="button"
            onClick={() => void saveIncident()}
            disabled={saving}
            data-action="api"
            data-endpoint="/incidents/:incidentId"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saveMsg && <p className="metric-label">{saveMsg}</p>}
        </div>
      </section>
        </>
      ) : null}

      {activeTab === "timeline" ? (
        <>
          <section className="panel">
            <h2>Incident timeline</h2>
            {analysisError ? <p className="dashboard-subtle">{analysisError}</p> : null}
            {timeline.length === 0 ? (
              <p className="dashboard-subtle">No timeline events available yet.</p>
            ) : (
              <div className="incident-timeline">
                {timeline.map((event) => (
                  <article
                    key={event.id}
                    className={`timeline-item ${event.severity ? `severity-${event.severity.toLowerCase()}` : ""}`.trim()}
                  >
                    <div className="timeline-head">
                      <strong>{event.summary}</strong>
                      <span className="pill">{event.eventType.replace(/_/g, " ")}</span>
                    </div>
                    <p className="timeline-meta">
                      {new Date(event.occurredAt).toLocaleString()}
                      {event.sourceType ? ` • ${event.sourceType}` : ""}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Correlation intelligence</h2>
            {intelligence ? (
              <div className="dashboard-list">
                <article className="dashboard-item">
                  <div className="root-cause-candidate-head">
                    <strong>Signal layer</strong>
                    <span className="pill">{intelligence.signalLayer.replace(/_/g, " ")}</span>
                  </div>
                  <p className="dashboard-subtle">
                    {intelligence.alertCount} linked alert{intelligence.alertCount === 1 ? "" : "s"}
                    {intelligence.mergedFromCount > 0 ? ` · ${intelligence.mergedFromCount} merged in` : ""}
                    {intelligence.reopenCount > 0 ? ` · reopened ${intelligence.reopenCount}×` : ""}
                  </p>
                  <p className="dashboard-subtle mono-meta">Fingerprint {intelligence.fingerprint}</p>
                  {intelligence.topCandidate ? (
                    <p className="dashboard-subtle">
                      Top evidence candidate: {intelligence.topCandidate.confidenceLabel ?? "POSSIBLE"} —{" "}
                      {intelligence.topCandidate.title}
                    </p>
                  ) : null}
                </article>
              </div>
            ) : (
              <p className="dashboard-subtle">Correlation intelligence is unavailable for this incident.</p>
            )}
          </section>

          <section className="panel">
            <h2>Root-cause candidates</h2>
            {rootCauseCandidates.length === 0 ? (
              <p className="dashboard-subtle">No ranked root-cause candidates are available yet.</p>
            ) : (
              <div className="dashboard-list">
                {rootCauseCandidates.map((candidate) => (
                  <article key={candidate.referenceId} className="dashboard-item root-cause-candidate-card">
                    <div className="root-cause-candidate-head">
                      <strong>{candidate.title}</strong>
                      <span
                        className={`confidence-badge ${(candidate.confidenceLabel ?? "POSSIBLE").toLowerCase()}`}
                      >
                        {candidate.confidenceLabel ?? "POSSIBLE"} · {Math.round(candidate.score * 100)}%
                      </span>
                    </div>
                    <p className="dashboard-subtle root-cause-candidate-meta">
                      {candidate.kind.replace(/_/g, " ")} • {candidate.rationale}
                    </p>
                    {candidate.evidenceSummary && candidate.evidenceSummary.length > 0 ? (
                      <ul className="intelligence-muted-list">
                        {candidate.evidenceSummary.slice(0, 3).map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : null}
                    {candidate.alternativeCauses && candidate.alternativeCauses.length > 0 ? (
                      <p className="dashboard-subtle">
                        Alternatives: {candidate.alternativeCauses.slice(0, 2).join(" · ")}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}

      <p className="incident-back-link">
        <Link href="/incidents" className="onboarding-link primary-button">
          ← Back to incidents
        </Link>
      </p>
    </Shell>
  );
}
