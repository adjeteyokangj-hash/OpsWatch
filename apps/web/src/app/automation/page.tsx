"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { PageSection } from "../../components/ui/page-section";
import { EmptyState } from "../../components/ui/empty-state";
import { StatusBadge } from "../../components/ui/status-badge";
import { StatCard } from "../../components/dashboard/stat-card";
import { apiFetch } from "../../lib/api";

type Phase7Run = {
  id: string;
  correlationId: string;
  projectId: string | null;
  environment: string | null;
  provider: string;
  actionKey: string;
  status: string;
  riskLevel: string;
  automationMode: string;
  requestedBy: string | null;
  approvedBy: string | null;
  failureReason: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  alertId: string | null;
  incidentId: string | null;
};

type Phase7Approval = {
  id: string;
  actionKey: string;
  decision: string;
  riskLevel: string;
  reason: string;
  expiresAt: string;
  correlationId: string;
  projectId: string | null;
  requestedBy: string | null;
  createdAt: string;
};

type Filters = {
  status: string;
  provider: string;
  action: string;
  risk: string;
  automationMode: string;
  environment: string;
};

const emptyFilters: Filters = {
  status: "",
  provider: "",
  action: "",
  risk: "",
  automationMode: "",
  environment: ""
};

export default function AutomationHubPage() {
  const [runs, setRuns] = useState<Phase7Run[]>([]);
  const [approvals, setApprovals] = useState<Phase7Approval[]>([]);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", "100");
      if (filters.status) params.set("status", filters.status);
      if (filters.provider) params.set("provider", filters.provider);
      if (filters.action) params.set("actionKey", filters.action);
      if (filters.risk) params.set("riskLevel", filters.risk);
      if (filters.automationMode) params.set("automationMode", filters.automationMode);
      if (filters.environment) params.set("environment", filters.environment);

      const payload = await apiFetch<{ runs: Phase7Run[]; pendingApprovals: Phase7Approval[] }>(
        `/remediation/runs?${params.toString()}`
      );
      setRuns(payload.runs ?? []);
      setApprovals(payload.pendingApprovals ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load remediation runs");
      setRuns([]);
      setApprovals([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buckets = useMemo(() => {
    const by = (status: string | string[]) => {
      const set = new Set(Array.isArray(status) ? status : [status]);
      return runs.filter((row) => set.has(row.status)).length;
    };
    return {
      pendingApprovals: approvals.length,
      ready: by(["APPROVED", "PROPOSED"]),
      running: by(["EXECUTING", "EXECUTED"]),
      verifying: by("VERIFYING"),
      completed: by("VERIFIED_HEALTHY"),
      failed: by(["VERIFICATION_FAILED", "DEAD_LETTER", "BLOCKED"]),
      rolledBack: by(["ROLLED_BACK", "ROLLBACK_FAILED"]),
      setupBlocked: by("BLOCKED")
    };
  }, [runs, approvals]);

  const decide = async (approvalId: string, decision: "APPROVED" | "REJECTED") => {
    setActing(approvalId);
    try {
      await apiFetch(`/remediation/approvals/${approvalId}/decide`, {
        method: "POST",
        body: JSON.stringify({ decision, reason: `Operator ${decision.toLowerCase()}` })
      });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Approval decision failed");
    } finally {
      setActing(null);
    }
  };

  return (
    <Shell>
      <Header title="Automation Centre" />
      <p className="dashboard-subtle">
        Real remediation approvals and execution runs from the Phase 7 governed registry. No seeded
        or fabricated runs.
      </p>

      <section className="grid-6 dashboard-metrics" data-testid="automation-workspace-metrics">
        <StatCard label="Pending approvals" value={loading ? "-" : buckets.pendingApprovals} />
        <StatCard label="Ready / proposed" value={loading ? "-" : buckets.ready} />
        <StatCard label="Running" value={loading ? "-" : buckets.running} />
        <StatCard label="Verifying" value={loading ? "-" : buckets.verifying} />
        <StatCard label="Verified healthy" value={loading ? "-" : buckets.completed} />
        <StatCard label="Failed / rolled back" value={loading ? "-" : buckets.failed + buckets.rolledBack} />
      </section>

      <PageSection
        title="Filters"
        description="Organisation-scoped real records. Apply filters then refresh."
      >
        <div className="form-grid" data-testid="automation-workspace-filters">
          {(
            [
              ["status", "State"],
              ["provider", "Provider"],
              ["action", "Action"],
              ["risk", "Risk"],
              ["automationMode", "Mode"],
              ["environment", "Environment"]
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={filters[key]}
                onChange={(event) => setFilters((prev) => ({ ...prev, [key]: event.target.value }))}
                placeholder={label}
              />
            </label>
          ))}
        </div>
        <div className="channel-actions">
          <button type="button" className="primary-button" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setFilters(emptyFilters);
            }}
          >
            Clear filters
          </button>
          <Link className="secondary-button" href="/automation/playbooks">
            Playbooks
          </Link>
        </div>
      </PageSection>

      <PageSection title="Pending approvals" description="Authorised decisions with expiry and revalidation.">
        {approvals.length === 0 ? (
          <EmptyState title="No pending approvals" description="Approval requests appear when policy requires them." />
        ) : (
          <div className="table-cards-wrap" data-testid="automation-pending-approvals">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Risk</th>
                  <th>Reason</th>
                  <th>Expires</th>
                  <th>Decide</th>
                </tr>
              </thead>
              <tbody>
                {approvals.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Action">
                      <code>{row.actionKey}</code>
                    </td>
                    <td data-label="Risk">{row.riskLevel}</td>
                    <td data-label="Reason">{row.reason}</td>
                    <td data-label="Expires">{new Date(row.expiresAt).toLocaleString()}</td>
                    <td data-label="Decide">
                      <button
                        type="button"
                        className="primary-button"
                        disabled={acting === row.id}
                        onClick={() => void decide(row.id, "APPROVED")}
                      >
                        Approve
                      </button>{" "}
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={acting === row.id}
                        onClick={() => void decide(row.id, "REJECTED")}
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageSection>

      <PageSection
        title="Remediation runs"
        description="Execution, verification, and rollback states with shared correlation IDs."
      >
        {error ? <p className="error-panel">{error}</p> : null}
        {loading ? <p>Loading remediation runs…</p> : null}
        {!loading && runs.length === 0 ? (
          <EmptyState
            title="No remediation runs yet"
            description="Runs appear after governed execute or autonomous low-risk actions."
          />
        ) : null}
        {!loading && runs.length > 0 ? (
          <div className="table-cards-wrap" data-testid="automation-workspace">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Status</th>
                  <th>Action</th>
                  <th>Provider</th>
                  <th>Risk</th>
                  <th>Mode</th>
                  <th>Correlation</th>
                  <th>Links</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((row) => (
                  <tr key={row.id} data-testid={`automation-run-${row.status}`}>
                    <td data-label="When">{new Date(row.createdAt).toLocaleString()}</td>
                    <td data-label="Status">
                      <StatusBadge label={row.status} tone="neutral" />
                    </td>
                    <td data-label="Action">
                      <code>{row.actionKey}</code>
                    </td>
                    <td data-label="Provider">{row.provider}</td>
                    <td data-label="Risk">{row.riskLevel}</td>
                    <td data-label="Mode">{row.automationMode}</td>
                    <td data-label="Correlation">
                      <code>{row.correlationId.slice(0, 8)}</code>
                    </td>
                    <td data-label="Links">
                      {row.incidentId ? (
                        <Link href={`/incidents/${row.incidentId}`}>Incident</Link>
                      ) : row.alertId ? (
                        <Link href={`/alerts/${row.alertId}`}>Alert</Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </PageSection>
    </Shell>
  );
}
