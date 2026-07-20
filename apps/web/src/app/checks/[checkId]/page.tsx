"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Shell } from "../../../components/layout/shell";
import { Header } from "../../../components/layout/header";
import { PageSection } from "../../../components/ui/page-section";
import { apiFetch } from "../../../lib/api";
import { StatCard } from "../../../components/dashboard/stat-card";
import { ConfigureSetupReturnBanner } from "../../../components/ui/configure-setup-return-banner";

type CheckDetail = {
  id: string;
  name: string;
  type: string;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatusCode: number | null;
  expectedKeyword: string | null;
  configJson: Record<string, unknown> | null;
  isActive: boolean;
  service: {
    id: string;
    name: string;
    project: {
      id: string;
      name: string;
      alerts?: Array<{ id: string; title: string; status: string }>;
      incidents?: Array<{ id: string; title: string; status: string }>;
    };
  };
  recentResults: Array<{
    id: string;
    status: string;
    responseCode: number | null;
    responseTimeMs: number | null;
    message: string | null;
    checkedAt: string;
  }>;
};

export default function CheckDetailPage() {
  const params = useParams<{ checkId: string }>();
  const [check, setCheck] = useState<CheckDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.checkId) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const row = await apiFetch<CheckDetail>(`/checks/${params.checkId}`);
        setCheck(row);
      } catch (err: any) {
        setError(err?.message || "Failed to load check");
        setCheck(null);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [params.checkId]);

  const passCount = useMemo(() => check?.recentResults.filter((r) => r.status === "PASS").length ?? 0, [check]);
  const failCount = useMemo(() => check?.recentResults.filter((r) => r.status === "FAIL").length ?? 0, [check]);
  const warnCount = useMemo(() => check?.recentResults.filter((r) => r.status === "WARN").length ?? 0, [check]);
  const avgLatency = useMemo(() => {
    if (!check) return 0;
    const values = check.recentResults.map((r) => r.responseTimeMs).filter((v): v is number => typeof v === "number");
    if (values.length === 0) return 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }, [check]);

  const latestResult = check?.recentResults[0] ?? null;
  const activeExceptions = useMemo(
    () => check?.recentResults.filter((result) => result.status === "FAIL" || result.status === "WARN").slice(0, 5) ?? [],
    [check]
  );
  const linkedAlerts = check?.service.project.alerts ?? [];
  const linkedIncidents = check?.service.project.incidents ?? [];

  if (loading) {
    return (
      <Shell>
          <Suspense fallback={null}>
            <ConfigureSetupReturnBanner />
          </Suspense>
        <Header title="Check" />
        <section className="panel">Loading check...</section>
      </Shell>
    );
  }

  if (!check) {
    return (
      <Shell>
        <Header title="Check" />
        {error ? <section className="panel error-panel">{error}</section> : null}
        <section className="panel">Check not found.</section>
      </Shell>
    );
  }

  return (
    <Shell>
      <Suspense fallback={null}>
        <ConfigureSetupReturnBanner />
      </Suspense>
      <Header title={`Check: ${check.name}`} />

      <section className="three-col">
        <StatCard
          label="Latest runs"
          value={check.recentResults.length}
          href={`/checks?serviceId=${check.service.id}`}
        />
        <StatCard
          label="Passing runs"
          value={passCount}
          href={`/checks?serviceId=${check.service.id}&latestStatus=PASS`}
        />
        <StatCard
          label="Avg latency"
          value={avgLatency ? `${avgLatency}ms` : "-"}
        />
        <StatCard
          label="Current state"
          value={latestResult?.status ?? "PENDING"}
          href={latestResult?.status === "FAIL" ? `/checks?serviceId=${check.service.id}&latestStatus=FAIL` : `/checks?serviceId=${check.service.id}`}
        />
        <StatCard
          label="Fail / warn"
          value={failCount + warnCount}
          href={`/checks?serviceId=${check.service.id}&latestStatus=FAIL`}
        />
      </section>

      <PageSection title="Configuration" persistKey="org:checks:configuration">
        <p><strong>Project:</strong> <Link href={`/projects/${check.service.project.id}`}>{check.service.project.name}</Link></p>
        <p><strong>Service:</strong> {check.service.name}</p>
        <p><strong>Type:</strong> {check.type}</p>
        <p><strong>Is active:</strong> {check.isActive ? "Yes" : "No"}</p>
        <p><strong>Schedule:</strong> every {check.intervalSeconds}s</p>
        <p><strong>Timeout:</strong> {check.timeoutMs}ms</p>
        <p><strong>Last checked:</strong> {latestResult ? new Date(latestResult.checkedAt).toLocaleString() : "Not yet run"}</p>
        <p>
          <strong>Next expected run:</strong>{" "}
          {latestResult
            ? new Date(new Date(latestResult.checkedAt).getTime() + check.intervalSeconds * 1000).toLocaleString()
            : "After first execution"}
        </p>
        <p><strong>Expected status code:</strong> {check.expectedStatusCode ?? "-"}</p>
        <p><strong>Expected keyword:</strong> {check.expectedKeyword ?? "-"}</p>
        <details>
          <summary>Show raw config JSON</summary>
          <pre>{JSON.stringify(check.configJson ?? {}, null, 2)}</pre>
        </details>
      </PageSection>

      <PageSection title="Active exceptions" persistKey="org:checks:exceptions">
        {activeExceptions.length === 0 ? (
          <p>No recent failures or warnings. This check is currently stable.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Checked at</th>
                <th>Latency</th>
                <th>HTTP Code</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {activeExceptions.map((result) => (
                <tr key={result.id}>
                  <td><span className={`result-pill ${result.status.toLowerCase()}`}>{result.status}</span></td>
                  <td>{new Date(result.checkedAt).toLocaleString()}</td>
                  <td>{result.responseTimeMs ? `${result.responseTimeMs} ms` : "-"}</td>
                  <td>{result.responseCode ?? "-"}</td>
                  <td>{result.message ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PageSection>

      <PageSection
        title="Run history"
        persistKey="org:checks:history"
        defaultCollapsed
      >
        {check.recentResults.length === 0 ? (
          <p>No executions yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Latency</th>
                <th>HTTP Code</th>
                <th>Checked At</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {check.recentResults.map((result) => (
                <tr key={result.id}>
                  <td><span className={`result-pill ${result.status.toLowerCase()}`}>{result.status}</span></td>
                  <td>{result.responseTimeMs ? `${result.responseTimeMs} ms` : "-"}</td>
                  <td>{result.responseCode ?? "-"}</td>
                  <td>{new Date(result.checkedAt).toLocaleString()}</td>
                  <td>{result.message ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PageSection>

      <section className="two-col">
        <PageSection title="Linked alerts" persistKey="org:checks:linked-alerts">
          {linkedAlerts.length === 0 ? (
            <p>No active alerts.</p>
          ) : (
            <ul>
              {linkedAlerts.map((alert) => (
                <li key={alert.id}><Link href={`/alerts/${alert.id}`}>{alert.title}</Link> ({alert.status})</li>
              ))}
            </ul>
          )}
        </PageSection>
        <PageSection title="Linked incidents" persistKey="org:checks:linked-incidents">
          {linkedIncidents.length === 0 ? (
            <p>No active incidents.</p>
          ) : (
            <ul>
              {linkedIncidents.map((incident) => (
                <li key={incident.id}><Link href={`/incidents/${incident.id}`}>{incident.title}</Link> ({incident.status})</li>
              ))}
            </ul>
          )}
        </PageSection>
      </section>
    </Shell>
  );
}
