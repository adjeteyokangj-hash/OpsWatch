"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Shell } from "../../../components/layout/shell";
import { Header } from "../../../components/layout/header";
import { apiFetch } from "../../../lib/api";

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
};

function AccuracyActionsContent() {
  const searchParams = useSearchParams();
  const [report, setReport] = useState<AccuracyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<AccuracyReport>("/remediation/accuracy");
        setReport(data);
      } catch (err: any) {
        setError(err?.message || "Failed to load action accuracy");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const rows = useMemo(() => {
    if (!report) return [];
    let result = [...(report.byAction ?? [])];

    const sort = searchParams.get("sort");
    const blockedReason = searchParams.get("blockedReason");

    if (blockedReason === "suppression") {
      result = result.filter((row) => row.suppressed);
    }

    if (sort === "overconfident") {
      result = result.sort((a, b) => b.overconfidenceRate - a.overconfidenceRate);
    }

    return result;
  }, [report, searchParams]);

  return (
    <Shell>
      <Header title="Accuracy Actions" />
      {error ? <section className="panel error-panel">{error}</section> : null}
      {loading ? (
        <section className="panel">Loading action analytics...</section>
      ) : rows.length === 0 ? (
        <section className="panel">No action analytics found.</section>
      ) : (
        <section className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Runs</th>
                <th>Success %</th>
                <th>Overconfidence %</th>
                <th>Suppressed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.action}>
                  <td><Link href={`/accuracy/actions/${row.action.toLowerCase().replace(/_/g, "-")}`}>{row.action.replace(/_/g, " ")}</Link></td>
                  <td>{row.total}</td>
                  <td>{Math.round(row.successRate)}%</td>
                  <td>{Math.round(row.overconfidenceRate)}%</td>
                  <td>{row.suppressed ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </Shell>
  );
}

export default function AccuracyActionsPage() {
  return (
    <Suspense fallback={<Shell><Header title="Accuracy Actions" /><section className="panel">Loading action analytics...</section></Shell>}>
      <AccuracyActionsContent />
    </Suspense>
  );
}
