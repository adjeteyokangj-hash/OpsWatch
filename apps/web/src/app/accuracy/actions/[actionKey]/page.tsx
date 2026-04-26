"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Shell } from "../../../../components/layout/shell";
import { Header } from "../../../../components/layout/header";
import { apiFetch } from "../../../../lib/api";

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
  byAction?: ActionAccuracy[];
};

type AutoRunMetrics = {
  byAction?: Array<{
    action: string;
    total: number;
    successRate: number | null;
    impactTier: string | null;
  }>;
};

const toActionEnum = (slug: string): string => slug.toUpperCase().replace(/-/g, "_");

export default function ActionAccuracyDetailPage() {
  const params = useParams<{ actionKey: string }>();
  const [report, setReport] = useState<AccuracyReport | null>(null);
  const [metrics, setMetrics] = useState<AutoRunMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const actionKey = params.actionKey;
  const actionEnum = toActionEnum(actionKey);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [accuracyReport, autoRunMetrics] = await Promise.all([
          apiFetch<AccuracyReport>("/remediation/accuracy"),
          apiFetch<AutoRunMetrics>("/remediation/auto-run/metrics")
        ]);
        setReport(accuracyReport);
        setMetrics(autoRunMetrics);
      } catch (err: any) {
        setError(err?.message || "Failed to load action details");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const action = useMemo(
    () => report?.byAction?.find((row) => row.action === actionEnum),
    [report, actionEnum]
  );

  const autoAction = useMemo(
    () => metrics?.byAction?.find((row) => row.action === actionEnum),
    [metrics, actionEnum]
  );

  return (
    <Shell>
      <Header title={`Action: ${actionEnum.replace(/_/g, " ")}`} />
      {error ? <section className="panel error-panel">{error}</section> : null}
      {loading ? (
        <section className="panel">Loading action details...</section>
      ) : !action ? (
        <section className="panel">Action not found.</section>
      ) : (
        <>
          <section className="three-col">
            <article className="panel metric-card">
              <div className="metric-label">Runs</div>
              <div className="metric-value">{action.total}</div>
            </article>
            <article className="panel metric-card">
              <div className="metric-label">Success / Failure</div>
              <div className="metric-value">{Math.round(action.successRate)}% / {Math.max(0, 100 - Math.round(action.successRate))}%</div>
            </article>
            <article className="panel metric-card">
              <div className="metric-label">False confidence</div>
              <div className="metric-value">{Math.round(action.overconfidenceRate)}%</div>
            </article>
          </section>

          <section className="panel">
            <h2>Policy + suppression</h2>
            <p><strong>Impact tier:</strong> {action.impactTier}</p>
            <p><strong>Suppressed:</strong> {action.suppressed ? "Yes" : "No"}</p>
            <p><strong>Underconfidence count:</strong> {action.underconfidenceCount}</p>
            <p><strong>Auto-run executions:</strong> {autoAction?.total ?? 0}</p>
            <p><strong>Auto-run success:</strong> {autoAction?.successRate ?? "-"}%</p>
          </section>

          <section className="panel">
            <h2>Recommended policy changes</h2>
            {action.suppressed ? (
              <p>Keep this action in manual or approval mode until error rates improve.</p>
            ) : action.successRate >= 90 ? (
              <p>Eligible for safer auto-run policy tier with standard cooldown.</p>
            ) : (
              <p>Retain approval-required tier and monitor confidence drift.</p>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}
