"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Shell } from "../../../components/layout/shell";
import { Header } from "../../../components/layout/header";
import { apiFetch } from "../../../lib/api";

type AlertDetail = {
  id: string;
  message: string;
  category: string;
  sourceType: string;
  project: { id: string; name: string } | null;
  service: { id: string; name: string } | null;
  assignedTo: { id: string; name: string; email: string } | null;
  incidents: Array<{ id: string; title: string; severity: string; status: string; openedAt: string }>;
  title: string;
  severity: string;
  status: string;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  otelEvidence?: Array<{
    id: string;
    evidenceKind: string;
    summary: string;
    confidence: number | null;
    traceId: string | null;
    spanId: string | null;
    observedAt: string;
  }>;
};

type AlertAutomationEvaluation = {
  alertId: string;
  evaluationStatus: string;
  evaluationTimestamp: string;
  automationMode: string;
  matchingPolicy: string | null;
  availableActions: string[];
  selectedAction: string | null;
  requiredPermissions: string[];
  approvalRequired: boolean;
  reasonNoAction: string | null;
  executionStatus: string | null;
  verificationStatus: string | null;
  finalOutcome: string | null;
  recoveryTimestamp: string | null;
  autoResolutionReason: string | null;
  remediationCausedRecovery: boolean | null;
  timeline: Array<{ stage: string; at: string | null; detail: string }>;
};

export default function AlertDetailPage() {
  const params = useParams<{ alertId: string }>();
  const alertId = params?.alertId ?? "";

  const [alert, setAlert] = useState<AlertDetail | null>(null);
  const [automation, setAutomation] = useState<AlertAutomationEvaluation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!alertId) return;
    setLoading(true);
    setError(null);
    try {
      const [row, evaluation] = await Promise.all([
        apiFetch<AlertDetail>(`/alerts/${alertId}`),
        apiFetch<AlertAutomationEvaluation>(`/alerts/${alertId}/automation`).catch(() => null)
      ]);
      setAlert(row);
      setAutomation(evaluation);
    } catch (err: any) {
      setError(err?.message || "Failed to load alert");
      setAlert(null);
      setAutomation(null);
    } finally {
      setLoading(false);
    }
  }, [alertId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runStatusAction = async (action: "acknowledge" | "resolve") => {
    if (!alert) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<AlertDetail>(`/alerts/${alert.id}/${action}`, {
        method: "PATCH"
      });
      setAlert(updated);
      const evaluation = await apiFetch<AlertAutomationEvaluation>(`/alerts/${alert.id}/automation`).catch(
        () => null
      );
      setAutomation(evaluation);
    } catch (err: any) {
      setError(err?.message || `Failed to ${action} alert`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell>
      <Header title={alert ? alert.title : "Alert"} />
      {error ? <section className="panel error-panel">{error}</section> : null}

      {loading ? (
        <section className="panel">Loading alert...</section>
      ) : !alert ? (
        <section className="panel">Alert not found.</section>
      ) : (
        <>
          <section className="three-col">
            <article className="panel metric-card">
              <div className="metric-label">Severity</div>
              <div className="metric-value">{alert.severity}</div>
            </article>
            <article className="panel metric-card">
              <div className="metric-label">Status</div>
              <div className="metric-value">{alert.status}</div>
            </article>
            <article className="panel metric-card">
              <div className="metric-label">First seen</div>
              <div className="metric-value">{new Date(alert.firstSeenAt).toLocaleString()}</div>
            </article>
          </section>

          <section className="panel">
            <div className="section-head">
              <div>
                <h2>Alert details</h2>
                <p>Review timestamps, metadata, and update alert status.</p>
              </div>
            </div>
            <p>
              <strong>Last seen:</strong> {new Date(alert.lastSeenAt).toLocaleString()}
            </p>
            <p>
              <strong>Project:</strong>{" "}
              {alert.project ? (
                <Link href={`/projects/${alert.project.id}`}>{alert.project.name}</Link>
              ) : (
                "-"
              )}
            </p>
            <p>
              <strong>Service:</strong>{" "}
              {alert.service ? <Link href={`/checks?serviceId=${alert.service.id}`}>{alert.service.name}</Link> : "-"}
            </p>
            <p>
              <strong>Source:</strong> {alert.sourceType} · {alert.category}
            </p>
            <p>
              <strong>Message:</strong> {alert.message}
            </p>
            {alert.otelEvidence && alert.otelEvidence.length > 0 ? (
              <div data-testid="otel-alert-evidence">
                <h3>OTEL evidence</h3>
                <ul className="dashboard-list">
                  {alert.otelEvidence.map((row) => (
                    <li key={row.id}>
                      <strong>{row.evidenceKind}</strong> — {row.summary}
                      <div className="dashboard-subtle">
                        {row.traceId ? `trace ${row.traceId.slice(0, 8)}… · ` : ""}
                        {row.confidence != null ? `confidence ${row.confidence} · ` : ""}
                        {new Date(row.observedAt).toLocaleString()}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p>
              <strong>Acknowledged:</strong>{" "}
              {alert.acknowledgedAt ? new Date(alert.acknowledgedAt).toLocaleString() : "-"}
            </p>
            <p>
              <strong>Resolved:</strong> {alert.resolvedAt ? new Date(alert.resolvedAt).toLocaleString() : "-"}
            </p>
            <p>
              <strong>Assigned to:</strong>{" "}
              {alert.assignedTo ? `${alert.assignedTo.name} (${alert.assignedTo.email})` : "-"}
            </p>

            <h3>Linked incidents</h3>
            {alert.incidents?.length === 0 ? (
              <p className="table-subtle">No incidents are currently linked to this alert.</p>
            ) : (
              <ul className="dashboard-list">
                {alert.incidents?.map((incident) => (
                  <li key={incident.id}>
                    <Link href={`/incidents/${incident.id}`}>{incident.title}</Link>
                    <div className="dashboard-subtle">
                      {incident.status} · {incident.severity} · Opened {new Date(incident.openedAt).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="channel-actions">
              <button
                type="button"
                className="secondary-button"
                data-action="api"
                data-endpoint="/alerts/:alertId/acknowledge"
                onClick={() => void runStatusAction("acknowledge")}
                disabled={saving || alert.status !== "OPEN"}
              >
                {saving ? "Saving..." : "Acknowledge"}
              </button>
              <button
                type="button"
                className="secondary-button"
                data-action="api"
                data-endpoint="/alerts/:alertId/resolve"
                onClick={() => void runStatusAction("resolve")}
                disabled={saving || alert.status === "RESOLVED"}
              >
                {saving ? "Saving..." : "Resolve"}
              </button>
            </div>
          </section>

          <section className="panel" data-testid="alert-automation-recovery">
            <div className="section-head">
              <div>
                <h2>Automation and recovery</h2>
                <p>Did OpsWatch only detect this, attempt a repair, or verify recovery?</p>
              </div>
            </div>
            {!automation ? (
              <p className="dashboard-subtle">Automation evaluation is unavailable for this alert.</p>
            ) : (
              <>
                <dl className="topology-detail-grid">
                  <div>
                    <dt>Detection status</dt>
                    <dd>{alert.status}</dd>
                  </div>
                  <div>
                    <dt>Evaluation status</dt>
                    <dd data-testid="alert-evaluation-status">{automation.evaluationStatus}</dd>
                  </div>
                  <div>
                    <dt>Automation mode</dt>
                    <dd>{automation.automationMode}</dd>
                  </div>
                  <div>
                    <dt>Matching policy</dt>
                    <dd>{automation.matchingPolicy ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Remediation availability</dt>
                    <dd>
                      {automation.availableActions.length > 0
                        ? automation.availableActions.join(", ")
                        : "No approved action available"}
                    </dd>
                  </div>
                  <div>
                    <dt>Selected action</dt>
                    <dd>{automation.selectedAction ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Approval required</dt>
                    <dd>{automation.approvalRequired ? "Yes" : "No"}</dd>
                  </div>
                  <div>
                    <dt>Execution status</dt>
                    <dd>{automation.executionStatus ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Verification</dt>
                    <dd>{automation.verificationStatus ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Final outcome</dt>
                    <dd>{automation.finalOutcome ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Recovery timestamp</dt>
                    <dd>
                      {automation.recoveryTimestamp
                        ? new Date(automation.recoveryTimestamp).toLocaleString()
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Auto-resolution reason</dt>
                    <dd>{automation.autoResolutionReason ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Remediation caused recovery</dt>
                    <dd>
                      {automation.remediationCausedRecovery == null
                        ? "—"
                        : automation.remediationCausedRecovery
                          ? "Yes"
                          : "No — recovered without remediation"}
                    </dd>
                  </div>
                </dl>
                {automation.reasonNoAction ? (
                  <p className="alert-automation-reason" data-testid="alert-no-action-reason" role="status">
                    {automation.reasonNoAction}
                  </p>
                ) : null}
                <h3>Remediation evidence timeline</h3>
                <ol className="alert-automation-timeline">
                  {automation.timeline.map((step) => (
                    <li key={`${step.stage}-${step.at ?? "pending"}`}>
                      <strong>{step.stage}</strong>
                      <div className="dashboard-subtle">
                        {step.at ? new Date(step.at).toLocaleString() : "Not started"} · {step.detail}
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        </>
      )}

      <p className="incident-back-link">
        <Link href="/alerts" className="onboarding-link primary-button">
          ← Back to alerts
        </Link>
      </p>
    </Shell>
  );
}
