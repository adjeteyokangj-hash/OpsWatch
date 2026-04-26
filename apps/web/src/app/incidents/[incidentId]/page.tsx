"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Shell } from "../../../components/layout/shell";
import { Header } from "../../../components/layout/header";
import { apiFetch } from "../../../lib/api";

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
};

type SuggestedAction = {
  action: string;
  label: string;
  description: string;
  group: "GROUP_A_SAFE" | "GROUP_B_APPROVAL" | "GROUP_C_SUPPORT";
  requiresApproval: boolean;
  kind: "fix" | "support";
  state: "READY" | "APPROVAL_REQUIRED" | "MISSING_CONTEXT" | "MISCONFIGURED_ENV" | "UNSUPPORTED";
  policyTier: "SAFE_AUTOMATIC" | "APPROVAL_REQUIRED" | "MANUAL_ONLY";
  confidenceScore: number;
  confidenceLabel: "HIGH" | "MEDIUM" | "LOW" | "BLOCKED";
  confidenceFactors: Array<{
    name: string;
    impact: number;
    description: string;
    status: "pass" | "warn" | "fail";
  }>;
  historicalSuccessRate: number | null;
  autoRunEligible: boolean;
  impactTier: "LOW" | "MEDIUM" | "HIGH";
  suppressionInfo: {
    suppressed: boolean;
    blocked: boolean;
    recentFailureRate: number;
    recentFailed: number;
    windowSize: number;
    reason: string;
  } | null;
  missingFields?: string[];
  missingEnvVars?: string[];
  suggestedContext?: Record<string, null>;
};

type DiagnosisResult = {
  diagnosis: string;
  confidence: number;
  category: string;
  suggestedActions: SuggestedAction[];
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

  useEffect(() => {
    if (!incidentId) return;

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const inc = await apiFetch<Incident>(`/incidents/${incidentId}`);
        setIncident(inc);
        setStatus(inc.status);
        setRootCause(inc.rootCause ?? "");
      } catch (err: any) {
        setLoadError(err?.message || "Failed to load incident");
        setIncident(null);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [incidentId]);

  const runDiagnosis = async () => {
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
  };

  const executeAction = async (action: string, requiresApproval: boolean) => {
    if (!incident) return;
    const shouldRequestApproval = requiresApproval
      ? window.confirm(
          "This action requires approval. Confirm you want to submit it for approval?"
        )
      : true;
    if (!shouldRequestApproval) return;

    setExecuting(action);
    try {
      const result = await apiFetch<RemediationResult>("/remediation/execute", {
        method: "POST",
        body: JSON.stringify({
          action,
          context: { incidentId: incident.id },
          approved: false,
        }),
      });
      setActionResults((prev) => ({ ...prev, [action]: result }));
    } finally {
      setExecuting(null);
    }
  };

  const saveIncident = async () => {
    if (!incident) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await apiFetch(`/incidents/${incident.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, rootCause: rootCause || null }),
      });
      setSaveMsg("Saved");
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

      <section className="panel">
        <h2>Operational context</h2>
        <div className="two-col">
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

      {/* ── AI Insight ─────────────────────────────────────────────── */}
      <section className="panel ai-insight-panel">
        <div className="section-head">
          <div>
            <h2>AI Insight</h2>
            <p>Rule-based diagnosis and suggested remediation actions.</p>
          </div>
          {!diagnosis && (
            <button
              className="primary-button"
              data-action="api"
              data-endpoint="/remediation/suggest"
              onClick={runDiagnosis}
              disabled={diagnosing}
            >
              {diagnosing ? "Analysing…" : "Run diagnosis"}
            </button>
          )}
        </div>

        {!diagnosis && !diagnosing && (
          <p className="metric-label">Click Run diagnosis to analyse this incident.</p>
        )}

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
              </div>
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
      </section>

      {/* ── Update incident ────────────────────────────────────────── */}
      <section className="panel">
        <h2>Update incident</h2>
        <div className="stack-form incident-update-form">
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
          <button onClick={saveIncident} disabled={saving} data-action="api" data-endpoint="/incidents/:incidentId">
            {saving ? "Saving…" : "Save"}
          </button>
          {saveMsg && <p className="metric-label">{saveMsg}</p>}
        </div>
      </section>

      <p className="incident-back-link">
        <Link href="/incidents" className="onboarding-link primary-button">
          ← Back to incidents
        </Link>
      </p>
    </Shell>
  );
}
