"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../lib/api";
import { PageSection } from "../ui/page-section";
import { StatusBadge } from "../ui/status-badge";

type Phase7Run = {
  id: string;
  correlationId: string;
  actionKey: string;
  status: string;
  riskLevel: string;
  automationMode: string;
  provider: string;
  approvedBy: string | null;
  failureReason: string | null;
  createdAt: string;
  incidentId?: string | null;
};

type Phase7Approval = {
  id: string;
  actionKey: string;
  decision: string;
  riskLevel: string;
  reason: string;
  correlationId: string;
  expiresAt: string;
  incidentId?: string | null;
};

type Props = {
  incidentId: string;
  projectId?: string;
};

export function IncidentRemediationTimeline({ incidentId, projectId }: Props) {
  const [runs, setRuns] = useState<Phase7Run[]>([]);
  const [approvals, setApprovals] = useState<Phase7Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: "50", incidentId });
        if (projectId) params.set("projectId", projectId);
        const payload = await apiFetch<{ runs: Phase7Run[]; pendingApprovals: Phase7Approval[] }>(
          `/remediation/runs?${params.toString()}`
        );
        setRuns(payload.runs ?? []);
        setApprovals(
          (payload.pendingApprovals ?? []).filter(
            (row) => !row.incidentId || row.incidentId === incidentId
          )
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load remediation timeline");
        setRuns([]);
        setApprovals([]);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [incidentId, projectId]);

  return (
    <PageSection
      title="Remediation timeline"
      description="Approvals, execution runs, verification, and rollback for this incident."
      persistKey={`incident:${incidentId}:remediation-timeline`}
      data-testid="incident-remediation-timeline"
      actions={
        <Link className="secondary-button" href="/automation">
          Automation workspace
        </Link>
      }
    >
      {loading ? <p>Loading remediation history…</p> : null}
      {error ? <p className="error-panel">{error}</p> : null}

      {!loading && approvals.length > 0 ? (
        <div data-testid="incident-remediation-approvals">
          <h3>Pending approvals</h3>
          <ul className="dashboard-list">
            {approvals.map((row) => (
              <li key={row.id}>
                <strong>{row.actionKey}</strong> · {row.riskLevel} · expires{" "}
                {new Date(row.expiresAt).toLocaleString()}
                <div className="dashboard-subtle">{row.reason}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!loading && runs.length === 0 ? (
        <p className="dashboard-subtle" data-testid="incident-remediation-empty">
          No governed remediation runs recorded for this incident yet.
        </p>
      ) : null}

      {!loading && runs.length > 0 ? (
        <ol className="alert-automation-timeline" data-testid="incident-remediation-runs">
          {runs.map((row) => (
            <li key={row.id}>
              <div className="channel-actions" style={{ justifyContent: "space-between" }}>
                <strong>{row.actionKey}</strong>
                <StatusBadge label={row.status} tone="neutral" />
              </div>
              <div className="dashboard-subtle">
                {row.automationMode} · {row.provider} · risk {row.riskLevel} · correlation{" "}
                <code>{row.correlationId.slice(0, 8)}</code>
              </div>
              <div className="dashboard-subtle">{new Date(row.createdAt).toLocaleString()}</div>
              {row.failureReason ? <p role="status">{row.failureReason}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </PageSection>
  );
}
