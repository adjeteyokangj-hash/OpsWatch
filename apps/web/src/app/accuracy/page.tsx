"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { apiFetch } from "../../lib/api";

type ActionAccuracy = {
  action: string;
  impactTier: string;
  total: number;
  successRate: number;
  overconfidenceRate: number;
  underconfidenceCount: number;
  suppressed: boolean;
};

type AccuracyReport = {
  overallAccuracy?: number;
  totalEvaluated?: number;
  overconfidenceRate?: number;
  byAction?: ActionAccuracy[];
  total?: number;
  success?: number;
  failed?: number;
  accuracy?: number;
};

type AutoRunActionStat = {
  action: string;
  total: number;
  successRate: number | null;
  impactTier: string | null;
};

type AutoRunMetrics = {
  totalAutoRuns?: number;
  autoRunSuccessRate?: number | null;
  succeeded?: number;
  failed?: number;
  blockedByPolicy?: number;
  blockedBySuppression?: number;
  blockedByConfidence?: number;
  byAction?: AutoRunActionStat[];
  total?: number;
};

type SortKey = "total" | "successRate" | "overconfidenceRate" | "suppressed" | "impactTier";

export default function AccuracyPage() {
  const [report, setReport] = useState<AccuracyReport | null>(null);
  const [autoRunMetrics, setAutoRunMetrics] = useState<AutoRunMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("total");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [data, metrics] = await Promise.all([
          apiFetch<AccuracyReport>("/remediation/accuracy"),
          apiFetch<AutoRunMetrics>("/remediation/auto-run/metrics"),
        ]);
        setReport(data);
        setAutoRunMetrics(metrics);
      } catch (err: any) {
        setError(err?.message ?? "Failed to load accuracy report");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) {
    return (
      <Shell>
        <Header title="Remediation Accuracy" />
        <p className="content">Loading…</p>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <Header title="Remediation Accuracy" />
        <section className="panel error-panel">{error}</section>
      </Shell>
    );
  }

  if (!report || report.totalEvaluated === 0) {
    const totalEvaluated = report?.totalEvaluated ?? report?.total ?? 0;
    if (totalEvaluated > 0) {
      // Continue rendering below with normalized data.
    } else {
    return (
      <Shell>
        <Header title="Remediation Accuracy" />
        <section className="panel">
          <p className="metric-label">No completed remediation runs yet. Accuracy data will appear once actions have been executed and resolved.</p>
        </section>
      </Shell>
    );
    }
  }

  const byAction = report?.byAction ?? [];
  const totalEvaluated = report?.totalEvaluated ?? report?.total ?? 0;
  const overallAccuracy = report?.overallAccuracy ?? report?.accuracy ?? 0;
  const overconfidenceRate = report?.overconfidenceRate ?? 0;

  const normalizedAutoRunMetrics = autoRunMetrics
    ? {
        totalAutoRuns: autoRunMetrics.totalAutoRuns ?? autoRunMetrics.total ?? 0,
        succeeded: autoRunMetrics.succeeded ?? 0,
        failed: autoRunMetrics.failed ?? Math.max(0, (autoRunMetrics.totalAutoRuns ?? autoRunMetrics.total ?? 0) - (autoRunMetrics.succeeded ?? 0)),
        blockedByPolicy: autoRunMetrics.blockedByPolicy ?? 0,
        blockedBySuppression: autoRunMetrics.blockedBySuppression ?? 0,
        blockedByConfidence: autoRunMetrics.blockedByConfidence ?? 0,
        autoRunSuccessRate:
          autoRunMetrics.autoRunSuccessRate ??
          ((autoRunMetrics.totalAutoRuns ?? autoRunMetrics.total ?? 0) > 0
            ? Math.round(((autoRunMetrics.succeeded ?? 0) / (autoRunMetrics.totalAutoRuns ?? autoRunMetrics.total ?? 1)) * 100)
            : null),
        byAction: autoRunMetrics.byAction ?? []
      }
    : null;

  const sorted = [...byAction].sort((a, b) => {
    if (sortKey === "total") return b.total - a.total;
    if (sortKey === "successRate") return a.successRate - b.successRate; // worst first
    if (sortKey === "overconfidenceRate") return b.overconfidenceRate - a.overconfidenceRate;
    if (sortKey === "suppressed") return (b.suppressed ? 1 : 0) - (a.suppressed ? 1 : 0);
    if (sortKey === "impactTier") {
      const order: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return (order[a.impactTier] ?? 99) - (order[b.impactTier] ?? 99);
    }
    return 0;
  });

  const topAutoRun = [...byAction]
    .filter((a) => !a.suppressed && a.successRate >= 0.8 && a.total >= 3)
    .sort((a, b) => b.successRate - a.successRate)
    .slice(0, 5);

  const worstPerforming = [...byAction]
    .filter((a) => a.total >= 3 && a.successRate < 100)
    .sort((a, b) => a.successRate - b.successRate)
    .slice(0, 5);

  const mostSuppressed = byAction.filter((a) => a.suppressed);

  return (
    <Shell>
      <Header title="Remediation Accuracy" />

      {/* ── Summary stats ──────────────────────────────────────────── */}
      <div className="grid-6" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="stat-card stat-card-link">
          <Link href="/accuracy/actions">
          <p className="label">Overall Accuracy</p>
          <p className="value">{Math.round(overallAccuracy)}%</p>
          </Link>
        </div>
        <div className="stat-card stat-card-link">
          <Link href="/accuracy/actions?evaluated=true">
          <p className="label">Total Evaluated</p>
          <p className="value">{totalEvaluated}</p>
          </Link>
        </div>
        <div className="stat-card stat-card-link">
          <Link href="/accuracy/actions?sort=overconfident">
          <p className="label">Overconfidence Rate</p>
          <p className="value">{Math.round(overconfidenceRate)}%</p>
          </Link>
        </div>
      </div>

      {/* ── Auto-run metrics (Phase 9) ─────────────────────────────── */}
      {normalizedAutoRunMetrics && (
        <section className="panel">
          <h2>Auto-Run Activity</h2>
          <p className="metric-label">Executions triggered by the controlled automatic path</p>
          <div className="grid-6" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: "12px" }}>
            <div className="stat-card">
              <p className="label">Total Auto-Runs</p>
              <p className="value">{normalizedAutoRunMetrics.totalAutoRuns}</p>
            </div>
            <div className="stat-card">
              <p className="label">Auto-Run Success Rate</p>
              <p className="value">
                {normalizedAutoRunMetrics.autoRunSuccessRate !== null ? `${normalizedAutoRunMetrics.autoRunSuccessRate}%` : "—"}
              </p>
            </div>
            <div className="stat-card">
              <p className="label">Succeeded / Failed</p>
              <p className="value">
                <span className="pass-rate">{normalizedAutoRunMetrics.succeeded}</span>
                {" / "}
                <span className="fail-rate">{normalizedAutoRunMetrics.failed}</span>
              </p>
            </div>
          </div>
          <div className="grid-6" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: "8px" }}>
            <div className="stat-card stat-card-link">
              <Link href="/accuracy/actions?blockedReason=policy">
              <p className="label">Blocked by Policy</p>
              <p className="value">{normalizedAutoRunMetrics.blockedByPolicy}</p>
              </Link>
            </div>
            <div className="stat-card stat-card-link">
              <Link href="/accuracy/actions?blockedReason=suppression">
              <p className="label">Blocked by Suppression</p>
              <p className="value">{normalizedAutoRunMetrics.blockedBySuppression}</p>
              </Link>
            </div>
            <div className="stat-card stat-card-link">
              <Link href="/accuracy/actions?blockedReason=confidence">
              <p className="label">Blocked by Confidence</p>
              <p className="value">{normalizedAutoRunMetrics.blockedByConfidence}</p>
              </Link>
            </div>
          </div>
          {normalizedAutoRunMetrics.byAction.length > 0 && (
            <div style={{ marginTop: "14px" }}>
              <p className="factors-label">Top auto-run actions</p>
              <ul className="accuracy-highlight-list">
                {normalizedAutoRunMetrics.byAction.slice(0, 5).map((a) => (
                  <li key={a.action} className="accuracy-highlight-item">
                    <Link className="accuracy-action-name" href={`/accuracy/actions/${a.action.toLowerCase().replace(/_/g, "-")}`}>
                      {a.action.replace(/_/g, " ")}
                    </Link>
                    {a.impactTier && (
                      <span className={`impact-tier-badge impact-tier-${a.impactTier.toLowerCase()}`}>
                        {a.impactTier}
                      </span>
                    )}
                    <span className="accuracy-rate">{a.total} runs</span>
                    {a.successRate !== null && (
                      <span className={`accuracy-rate ${a.successRate >= 80 ? "pass-rate" : a.successRate >= 50 ? "warn-rate" : "fail-rate"}`}>
                        {a.successRate}% success
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ── Highlights ─────────────────────────────────────────────── */}
      <div className="two-col">
        {/* Top auto-run candidates */}
        <section className="panel">
          <h2>Top Auto-Run Candidates</h2>
          <p className="metric-label">High success rate, not suppressed, ≥3 runs</p>
          {topAutoRun.length === 0 ? (
            <p className="metric-label">No qualifying actions yet.</p>
          ) : (
            <ul className="accuracy-highlight-list">
              {topAutoRun.map((a) => (
                <li key={a.action} className="accuracy-highlight-item">
                  <Link className="accuracy-action-name" href={`/accuracy/actions/${a.action.toLowerCase().replace(/_/g, "-")}`}>
                    {a.action.replace(/_/g, " ")}
                  </Link>
                  <span className={`impact-tier-badge impact-tier-${a.impactTier.toLowerCase()}`}>
                    {a.impactTier}
                  </span>
                  <span className="accuracy-rate pass-rate">
                    {Math.round(a.successRate)}% success
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Worst performing */}
        <section className="panel">
          <h2>Worst Performing</h2>
          <p className="metric-label">Lowest success rate with ≥3 runs</p>
          {worstPerforming.length === 0 ? (
            <p className="metric-label">No qualifying actions yet.</p>
          ) : (
            <ul className="accuracy-highlight-list">
              {worstPerforming.map((a) => (
                <li key={a.action} className="accuracy-highlight-item">
                  <Link className="accuracy-action-name" href={`/accuracy/actions/${a.action.toLowerCase().replace(/_/g, "-")}`}>
                    {a.action.replace(/_/g, " ")}
                  </Link>
                  <span className={`impact-tier-badge impact-tier-${a.impactTier.toLowerCase()}`}>
                    {a.impactTier}
                  </span>
                  <span className="accuracy-rate fail-rate">
                    {Math.round(a.successRate)}% success
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── Suppressed actions ─────────────────────────────────────── */}
      {mostSuppressed.length > 0 && (
        <section className="panel">
          <h2>Suppressed Actions</h2>
          <p className="metric-label">Auto-run currently restricted due to recent failure rate</p>
          <div className="accuracy-suppressed-list">
            {mostSuppressed.map((a) => (
              <div key={a.action} className="suppression-callout suppression-warn" style={{ marginBottom: "8px" }}>
                <span className="suppression-icon">⚠</span>
                <div className="suppression-body">
                  <p className="suppression-title">{a.action.replace(/_/g, " ")}</p>
                  <p className="suppression-detail">
                    {Math.round(a.successRate)}% success rate across {a.total} runs
                    {" · "}
                    <span className={`impact-tier-badge impact-tier-${a.impactTier.toLowerCase()}`} style={{ fontSize: "0.7rem" }}>
                      {a.impactTier} impact
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Per-action table ───────────────────────────────────────── */}
      <section className="panel">
        <div className="section-head">
          <h2>All Actions</h2>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span className="metric-label">Sort by:</span>
            {(["total", "successRate", "overconfidenceRate", "impactTier", "suppressed"] as SortKey[]).map((k) => (
              <button
                key={k}
                className={`sort-btn ${sortKey === k ? "sort-btn-active" : ""}`}
                onClick={() => setSortKey(k)}
              >
                {k === "total" ? "Most runs"
                  : k === "successRate" ? "Worst success"
                  : k === "overconfidenceRate" ? "Overconfident"
                  : k === "impactTier" ? "Impact tier"
                  : "Suppressed"}
              </button>
            ))}
          </div>
        </div>
        <table className="data-table" style={{ marginTop: "12px" }}>
          <thead>
            <tr>
              <th>Action</th>
              <th>Impact</th>
              <th>Runs</th>
              <th>Success Rate</th>
              <th>Overconfidence</th>
              <th>Underconfident</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => (
              <tr key={a.action}>
                <td style={{ fontWeight: 500 }}>
                  <Link href={`/accuracy/actions/${a.action.toLowerCase().replace(/_/g, "-")}`}>{a.action.replace(/_/g, " ")}</Link>
                </td>
                <td>
                  <span className={`impact-tier-badge impact-tier-${a.impactTier.toLowerCase()}`}>
                    {a.impactTier}
                  </span>
                </td>
                <td>{a.total}</td>
                <td>
                  <span className={a.successRate >= 80 ? "pass-rate" : a.successRate >= 50 ? "warn-rate" : "fail-rate"}>
                    {Math.round(a.successRate)}%
                  </span>
                </td>
                <td>
                  <span className={a.overconfidenceRate > 30 ? "fail-rate" : a.overconfidenceRate > 10 ? "warn-rate" : ""}>
                    {Math.round(a.overconfidenceRate)}%
                  </span>
                </td>
                <td>{a.underconfidenceCount}</td>
                <td>
                  {a.suppressed ? (
                    <span className="result-pill warn">Suppressed</span>
                  ) : (
                    <span className="result-pill pass">Active</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </Shell>
  );
}
