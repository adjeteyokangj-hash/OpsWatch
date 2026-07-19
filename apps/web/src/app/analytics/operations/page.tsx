"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "../../../components/layout/shell";
import { Header } from "../../../components/layout/header";
import { StatCard } from "../../../components/dashboard/stat-card";
import { StatusBadge } from "../../../components/ui/status-badge";
import { apiFetch } from "../../../lib/api";

type OperationsAnalytics = {
  windowDays: number;
  incidents: {
    opened: number;
    resolved: number;
    mttdMinutes: number | null;
    mttaMinutes: number | null;
    mttrMinutes: number | null;
  };
  automation: {
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    autonomousRuns: number;
    approvalPendingRuns: number;
    successRate: number | null;
  };
  playbooks: {
    activePlaybooks: number;
    approvedVersions: number;
    draftVersions: number;
    inReviewVersions: number;
  };
  correlation: {
    groupedIncidents: number;
    correlatedGroups: number;
    avgAlertsPerIncident: number | null;
  };
  maintenance: {
    activeWindows: number;
    scheduledWindows: number;
    suppressedAlerts: number;
  };
};

const formatMinutes = (value: number | null): string => {
  if (value == null) return "Unavailable";
  if (value < 60) return `${Math.round(value)}m`;
  return `${(value / 60).toFixed(1)}h`;
};

export default function OperationsAnalyticsPage() {
  const [data, setData] = useState<OperationsAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const row = await apiFetch<OperationsAnalytics>("/analytics/operations?windowDays=30");
        setData(row);
        setError(null);
      } catch (err: any) {
        setError(err?.message ?? "Failed to load operations analytics");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  return (
    <Shell>
      <Header title="Operations Analytics" />
      <section className="panel">
        <nav className="pill-row">
          <Link className="pill" href="/accuracy">
            Remediation accuracy
          </Link>
          <span className="pill">Operations</span>
        </nav>
        <p className="dashboard-subtle">
          <StatusBadge label="Live calculated" tone="success" /> Rolling {data?.windowDays ?? 30}-day
          calculations from persisted incidents, automation runs, playbook versions, and maintenance records.
          Unavailable means the required timestamps or outcomes do not exist; it does not mean zero.
        </p>
      </section>

      {error ? <section className="panel error-panel">{error}</section> : null}
      {loading || !data ? (
        <section className="panel">Loading analytics…</section>
      ) : (
        <>
          <section className="panel">
            <h2>Incident response</h2>
            <div className="four-col">
              <StatCard label="Opened" value={String(data.incidents.opened)} />
              <StatCard label="Resolved" value={String(data.incidents.resolved)} />
              <StatCard label="MTTA" value={formatMinutes(data.incidents.mttaMinutes)} />
              <StatCard label="MTTR" value={formatMinutes(data.incidents.mttrMinutes)} />
            </div>
          </section>

          <section className="panel">
            <h2>Automation</h2>
            <div className="four-col">
              <StatCard label="Total runs" value={String(data.automation.totalRuns)} />
              <StatCard label="Success rate" value={data.automation.successRate != null ? `${data.automation.successRate}%` : "—"} />
              <StatCard label="Autonomous" value={String(data.automation.autonomousRuns)} />
              <StatCard label="Awaiting approval" value={String(data.automation.approvalPendingRuns)} />
            </div>
          </section>

          <section className="panel">
            <h2>Correlation &amp; maintenance</h2>
            <div className="four-col">
              <StatCard label="Correlated groups" value={String(data.correlation.correlatedGroups)} />
              <StatCard label="Avg alerts / incident" value={data.correlation.avgAlertsPerIncident != null ? String(data.correlation.avgAlertsPerIncident) : "—"} />
              <StatCard label="Active maintenance" value={String(data.maintenance.activeWindows)} />
              <StatCard label="Suppressed alerts" value={String(data.maintenance.suppressedAlerts)} />
            </div>
          </section>

          <section className="panel">
            <h2>Playbook governance</h2>
            <div className="four-col">
              <StatCard label="Active playbooks" value={String(data.playbooks.activePlaybooks)} />
              <StatCard label="Approved versions" value={String(data.playbooks.approvedVersions)} />
              <StatCard label="Draft versions" value={String(data.playbooks.draftVersions)} />
              <StatCard label="In review" value={String(data.playbooks.inReviewVersions)} />
            </div>
          </section>
        </>
      )}
    </Shell>
  );
}
