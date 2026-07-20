"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Shell } from "../../../components/layout/shell";
import { Header } from "../../../components/layout/header";
import { PageSection } from "../../../components/ui/page-section";
import {
  AlertRepairConfirmDrawer,
  type AlertRepairConfirmInput
} from "../../../components/alerts/alert-repair-confirm-drawer";
import { apiFetch } from "../../../lib/api";
import { fetchSessionUser } from "../../../lib/auth";

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
  logEvidence?: Array<{
    id: string;
    evidenceKind: string;
    summary: string;
    confidence: number | null;
    occurrenceGroupId: string | null;
    logRecordId: string | null;
    observedAt: string;
  }>;
  spanEvidence?: Array<{
    id: string;
    evidenceKind: string;
    summary: string;
    confidence: number | null;
    traceId: string | null;
    spanId: string | null;
    observedAt: string;
  }>;
  apmEvidence?: Array<{
    id: string;
    evidenceKind: string;
    summary: string;
    confidence: number | null;
    observedAt: string;
  }>;
  operationalEntityId?: string | null;
  operationalRelationshipId?: string | null;
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
  availabilityState?: string | null;
  availabilityReason?: string | null;
  riskLevel?: string | null;
  runId?: string | null;
  correlationId?: string | null;
  timeline: Array<{ stage: string; at: string | null; detail: string }>;
  failureClass?: string | null;
  diagnosisSummary?: string | null;
  recommendedActionLabel?: string | null;
  primaryCtaKind?: string | null;
  checkId?: string | null;
  configureHref?: string | null;
  projectId?: string | null;
  verificationPassed?: boolean;
};

export default function AlertDetailPage() {
  const params = useParams<{ alertId: string }>();
  const alertId = params?.alertId ?? "";

  const [alert, setAlert] = useState<AlertDetail | null>(null);
  const [automation, setAutomation] = useState<AlertAutomationEvaluation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [repairBusy, setRepairBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerRepair, setDrawerRepair] = useState<AlertRepairConfirmInput | null>(null);
  const [resolvePrompt, setResolvePrompt] = useState(false);
  const [resolveReason, setResolveReason] = useState("");

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

  useEffect(() => {
    void fetchSessionUser()
      .then((user) => setIsAdmin(user?.role === "ADMIN"))
      .catch(() => setIsAdmin(false));
  }, []);

  const runAcknowledge = async () => {
    if (!alert) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<AlertDetail>(`/alerts/${alert.id}/acknowledge`, {
        method: "PATCH"
      });
      setAlert(updated);
      const evaluation = await apiFetch<AlertAutomationEvaluation>(`/alerts/${alert.id}/automation`).catch(
        () => null
      );
      setAutomation(evaluation);
    } catch (err: any) {
      setError(err?.message || "Failed to acknowledge alert");
    } finally {
      setSaving(false);
    }
  };

  const runResolve = async (reason?: string) => {
    if (!alert) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<AlertDetail>(`/alerts/${alert.id}/resolve`, {
        method: "PATCH",
        body: JSON.stringify(reason ? { reason, force: true } : {})
      });
      setAlert(updated);
      setResolvePrompt(false);
      setResolveReason("");
      const evaluation = await apiFetch<AlertAutomationEvaluation>(`/alerts/${alert.id}/automation`).catch(
        () => null
      );
      setAutomation(evaluation);
    } catch (err: any) {
      setError(err?.message || "Failed to resolve alert");
    } finally {
      setSaving(false);
    }
  };

  const openResolveFlow = () => {
    if (automation?.verificationPassed) {
      void runResolve();
      return;
    }
    setResolvePrompt(true);
  };

  const openRepairDrawer = (oneTimeOverride = false) => {
    if (!automation?.selectedAction) {
      setError("No recommended repair action is available for this alert.");
      return;
    }
    setDrawerRepair({
      actionKey: automation.selectedAction,
      actionLabel: automation.recommendedActionLabel ?? automation.selectedAction,
      diagnosisSummary: automation.diagnosisSummary ?? alert?.message ?? null,
      riskLevel: automation.riskLevel ?? null,
      approvalRequired: automation.approvalRequired || oneTimeOverride,
      verificationStrategy:
        automation.timeline.find((step) => step.stage === "Verification method")?.detail ?? null,
      whySelected: automation.matchingPolicy
        ? `Matched via ${automation.matchingPolicy}`
        : automation.availabilityReason ?? null,
      availabilityReason: automation.availabilityReason ?? null,
      oneTimeOverride
    });
    setDrawerOpen(true);
  };

  const executeRepair = async (input: { note: string }) => {
    if (!alert || !automation?.selectedAction) {
      throw new Error("Missing alert or selected action");
    }
    setRepairBusy(true);
    setError(null);
    try {
      const projectId = alert.project?.id ?? automation.projectId ?? undefined;
      const oneTime = Boolean(drawerRepair?.oneTimeOverride);
      const automationModeForRun = oneTime || automation.approvalRequired ? "APPROVAL" : "APPROVAL";
      let approvalId: string | undefined;

      if (automation.approvalRequired || oneTime) {
        const approval = await apiFetch<{ id: string }>("/remediation/approvals", {
          method: "POST",
          body: JSON.stringify({
            actionKey: automation.selectedAction,
            projectId,
            alertId: alert.id,
            serviceId: alert.service?.id,
            checkId: automation.checkId,
            reason: input.note || "Operator confirmed recommended alert repair",
            automationMode: "APPROVAL",
            evidence: {
              failureClass: automation.failureClass,
              diagnosisSummary: automation.diagnosisSummary
            }
          })
        });
        approvalId = approval.id;

        if (isAdmin) {
          await apiFetch(`/remediation/approvals/${approval.id}/decide`, {
            method: "POST",
            body: JSON.stringify({
              decision: "APPROVED",
              reason: input.note || "Administrator approved one-time alert repair"
            })
          });
        } else {
          setError("Repair approval requested. An administrator must approve before execution.");
          await load();
          return;
        }
      }

      await apiFetch("/remediation/governed-execute", {
        method: "POST",
        body: JSON.stringify({
          actionKey: automation.selectedAction,
          projectId,
          alertId: alert.id,
          serviceId: alert.service?.id,
          approvalId,
          automationMode: automationModeForRun,
          note: input.note || undefined,
          idempotencyKey: `alert:${alert.id}:${automation.selectedAction}:${Date.now()}`,
          extra: automation.checkId ? { checkId: automation.checkId } : undefined
        })
      });
      await load();
    } finally {
      setRepairBusy(false);
    }
  };

  const requestApprovalOnly = async () => {
    if (!alert || !automation?.selectedAction) return;
    setRepairBusy(true);
    setError(null);
    try {
      await apiFetch("/remediation/approvals", {
        method: "POST",
        body: JSON.stringify({
          actionKey: automation.selectedAction,
          projectId: alert.project?.id ?? automation.projectId,
          alertId: alert.id,
          serviceId: alert.service?.id,
          checkId: automation.checkId,
          reason: "Technician requested repair approval from alert detail",
          automationMode: "APPROVAL",
          evidence: {
            failureClass: automation.failureClass,
            diagnosisSummary: automation.diagnosisSummary
          }
        })
      });
      setError(null);
      await load();
      setError("Repair approval requested. Waiting for an administrator decision.");
    } catch (err: any) {
      setError(err?.message || "Failed to request repair approval");
    } finally {
      setRepairBusy(false);
    }
  };

  const ctaKind = automation?.primaryCtaKind ?? "NONE";
  const projectId = alert?.project?.id ?? automation?.projectId ?? null;
  const automationHref = projectId ? `/projects/${projectId}/automation` : "/automation";
  const remediatorHref = projectId
    ? `/projects/${projectId}/integrations/worker_provider`
    : "/integrations";

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

          <PageSection
            title="Alert details"
            description="Review timestamps, metadata, and update alert status. Acknowledge means ownership — not repair."
            persistKey={`alert:${alertId}:details`}
            actions={
              <div className="channel-actions">
                <button
                  type="button"
                  className="secondary-button"
                  data-action="api"
                  data-endpoint="/alerts/:alertId/acknowledge"
                  onClick={() => void runAcknowledge()}
                  disabled={saving || alert.status !== "OPEN"}
                >
                  {saving ? "Saving..." : "Acknowledge"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  data-action="api"
                  data-endpoint="/alerts/:alertId/resolve"
                  onClick={() => openResolveFlow()}
                  disabled={saving || alert.status === "RESOLVED"}
                >
                  {saving ? "Saving..." : "Resolve"}
                </button>
              </div>
            }
          >
            {resolvePrompt ? (
              <div className="panel notice-panel" data-testid="alert-resolve-reason">
                <p>
                  Manual resolve requires a reason unless OpsWatch has verified recovery. This does not run a
                  repair.
                </p>
                <label>
                  Resolution reason
                  <textarea
                    value={resolveReason}
                    onChange={(event) => setResolveReason(event.target.value)}
                    rows={3}
                    required
                    placeholder="e.g. Check URL updated to public health endpoint; monitoring confirmed healthy"
                  />
                </label>
                <div className="channel-actions">
                  <button type="button" className="secondary-button" onClick={() => setResolvePrompt(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={saving || !resolveReason.trim()}
                    onClick={() => void runResolve(resolveReason.trim())}
                  >
                    Confirm resolve
                  </button>
                </div>
              </div>
            ) : null}
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
              {alert.service ? (
                <Link href={`/checks?serviceId=${alert.service.id}`}>{alert.service.name}</Link>
              ) : (
                "-"
              )}
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
            {alert.logEvidence?.length || alert.spanEvidence?.length || alert.apmEvidence?.length ? (
              <div data-testid="logs-apm-alert-evidence">
                <h3>Logs / APM evidence</h3>
                <ul className="dashboard-list">
                  {(alert.logEvidence ?? []).map((row) => (
                    <li key={`log-${row.id}`}>
                      <strong>Log · {row.evidenceKind}</strong> — {row.summary}
                      <div className="dashboard-subtle">
                        {row.occurrenceGroupId ? `group ${row.occurrenceGroupId.slice(0, 8)}… · ` : ""}
                        {new Date(row.observedAt).toLocaleString()}
                      </div>
                    </li>
                  ))}
                  {(alert.spanEvidence ?? []).map((row) => (
                    <li key={`span-${row.id}`}>
                      <strong>Trace · {row.evidenceKind}</strong> — {row.summary}
                      <div className="dashboard-subtle">
                        {row.traceId ? `trace ${row.traceId.slice(0, 8)}… · ` : ""}
                        {row.spanId ? `span ${row.spanId.slice(0, 8)}… · ` : ""}
                        {new Date(row.observedAt).toLocaleString()}
                      </div>
                    </li>
                  ))}
                  {(alert.apmEvidence ?? []).map((row) => (
                    <li key={`apm-${row.id}`}>
                      <strong>APM · {row.evidenceKind}</strong> — {row.summary}
                      <div className="dashboard-subtle">{new Date(row.observedAt).toLocaleString()}</div>
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
                      {incident.status} · {incident.severity} · Opened{" "}
                      {new Date(incident.openedAt).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PageSection>

          <PageSection
            title="Automation and recovery"
            description="Recommended repair, policy gates, and verification evidence."
            persistKey={`alert:${alertId}:automation`}
            defaultCollapsed={alert.status === "RESOLVED"}
            data-testid="alert-automation-recovery"
          >
            {!automation ? (
              <p className="dashboard-subtle">Automation evaluation is unavailable for this alert.</p>
            ) : (
              <>
                <div className="alert-repair-cta" data-testid="alert-repair-cta">
                  {automation.diagnosisSummary ? (
                    <p className="alert-automation-reason" role="status">
                      <strong>Diagnosis:</strong> {automation.diagnosisSummary}
                    </p>
                  ) : null}

                  {ctaKind === "CONFIGURE_CHECK" ? (
                    <div className="channel-actions">
                      <Link
                        className="primary-button"
                        href={automation.configureHref ?? `/checks`}
                        data-testid="alert-configure-check"
                      >
                        Review check configuration
                      </Link>
                      {projectId ? (
                        <Link className="secondary-button" href={`/projects/${projectId}/integrations`}>
                          Connect private-network worker
                        </Link>
                      ) : null}
                    </div>
                  ) : null}

                  {ctaKind === "EXECUTE" ? (
                    <div className="channel-actions">
                      <button
                        type="button"
                        className="primary-button"
                        data-testid="alert-run-recommended-fix"
                        disabled={repairBusy || !automation.selectedAction}
                        onClick={() => openRepairDrawer(false)}
                      >
                        {repairBusy ? "Working…" : "Run recommended fix"}
                      </button>
                    </div>
                  ) : null}

                  {ctaKind === "REQUEST_APPROVAL" ? (
                    <div className="channel-actions">
                      {isAdmin ? (
                        <button
                          type="button"
                          className="primary-button"
                          data-testid="alert-approve-one-time"
                          disabled={repairBusy || !automation.selectedAction}
                          onClick={() => openRepairDrawer(true)}
                        >
                          Approve one-time repair
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="primary-button"
                          data-testid="alert-request-approval"
                          disabled={repairBusy || !automation.selectedAction}
                          onClick={() => void requestApprovalOnly()}
                        >
                          Request repair approval
                        </button>
                      )}
                    </div>
                  ) : null}

                  {ctaKind === "OBSERVE_BLOCKED" ? (
                    <>
                      <button
                        type="button"
                        className="primary-button"
                        data-testid="alert-run-recommended-fix-unavailable"
                        disabled
                        title={automation.availabilityReason ?? "Execution prohibited"}
                      >
                        Run recommended fix — unavailable
                      </button>
                      <p className="alert-automation-reason" role="status">
                        This application is in Observe / Monitor Only mode. Change the automation policy or
                        approve a one-time repair to allow OpsWatch to execute the recommended action.
                      </p>
                      <div className="channel-actions">
                        {isAdmin ? (
                          <>
                            <button
                              type="button"
                              className="secondary-button"
                              data-testid="alert-approve-one-time"
                              disabled={repairBusy || !automation.selectedAction}
                              onClick={() => openRepairDrawer(true)}
                            >
                              Approve one-time repair
                            </button>
                            <Link className="secondary-button" href={automationHref}>
                              Change automation policy
                            </Link>
                            <Link className="secondary-button" href={remediatorHref}>
                              Open remediation settings
                            </Link>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="secondary-button"
                            data-testid="alert-request-approval"
                            disabled={repairBusy || !automation.selectedAction}
                            onClick={() => void requestApprovalOnly()}
                          >
                            Request repair approval
                          </button>
                        )}
                      </div>
                    </>
                  ) : null}

                  {ctaKind === "SETUP_REQUIRED" ? (
                    <div className="channel-actions">
                      <Link className="primary-button" href={remediatorHref}>
                        Open remediation settings
                      </Link>
                      <Link className="secondary-button" href={automationHref}>
                        Change automation policy
                      </Link>
                    </div>
                  ) : null}

                  {automation.recommendedActionLabel || automation.selectedAction ? (
                    <p className="dashboard-subtle">
                      Recommended: <strong>{automation.recommendedActionLabel ?? automation.selectedAction}</strong>
                      {automation.selectedAction ? (
                        <>
                          {" "}
                          (<code>{automation.selectedAction}</code>)
                        </>
                      ) : null}
                    </p>
                  ) : null}
                </div>

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
                    <dt>Availability</dt>
                    <dd data-testid="alert-availability-state">
                      {automation.availabilityState ?? automation.evaluationStatus}
                    </dd>
                  </div>
                  <div>
                    <dt>Availability reason</dt>
                    <dd data-testid="alert-availability-reason">
                      {automation.availabilityReason ?? automation.reasonNoAction ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Failure class</dt>
                    <dd>{automation.failureClass ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Risk</dt>
                    <dd>{automation.riskLevel ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Correlation ID</dt>
                    <dd data-testid="alert-remediation-correlation">
                      {automation.correlationId ? <code>{automation.correlationId}</code> : "—"}
                    </dd>
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
          </PageSection>
        </>
      )}

      <AlertRepairConfirmDrawer
        open={drawerOpen}
        repair={drawerRepair}
        submitting={repairBusy}
        onClose={() => {
          setDrawerOpen(false);
          setDrawerRepair(null);
        }}
        onConfirm={executeRepair}
      />

      <p className="incident-back-link">
        <Link href="/alerts" className="onboarding-link primary-button">
          ← Back to alerts
        </Link>
      </p>
    </Shell>
  );
}
