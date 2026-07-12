"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { HealthBadge } from "../../components/health/health-badge";
import { apiFetch } from "../../lib/api";

type ServiceRow = {
  id: string;
  name: string;
  type: string;
  status: string;
  Project: { id: string; name: string };
};

function WorkflowsPageContent() {
  const searchParams = useSearchParams();
  const health = searchParams.get("health");
  const [rows, setRows] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await apiFetch<ServiceRow[]>("/services");
        setRows(data.filter((row) => row.type === "WORKFLOW"));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const filtered = useMemo(() => {
    if (!health) return rows;
    if (health === "healthy") return rows.filter((r) => r.status === "HEALTHY");
    if (health === "critical") return rows.filter((r) => r.status === "DOWN");
    if (health === "warning") return rows.filter((r) => ["DEGRADED", "RECOVERING", "MAINTENANCE", "PAUSED"].includes(r.status));
    if (health === "unknown") return rows.filter((r) => r.status === "UNKNOWN");
    return rows.filter((r) => r.status === health);
  }, [rows, health]);

  return (
    <Shell>
      <Header title="Workflows" />
      <p className="dashboard-subtle">Workflow-layer health across all applications.</p>
      <section className="pill-row">
        <Link className={!health ? "pill active" : "pill"} href="/workflows">All</Link>
        <Link className={health === "healthy" ? "pill active" : "pill"} href="/workflows?health=healthy">Healthy</Link>
        <Link className={health === "warning" ? "pill active" : "pill"} href="/workflows?health=warning">Warning</Link>
        <Link className={health === "critical" ? "pill active" : "pill"} href="/workflows?health=critical">Critical</Link>
      </section>
      {loading ? <p>Loading workflows…</p> : null}
      {!loading ? (
        <section className="panel">
          <h2>{filtered.length} workflow{filtered.length === 1 ? "" : "s"}</h2>
          <div className="layer-health-table-wrap">
            <table className="data-table layer-health-table">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Application</th>
                  <th>Health</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>
                      <Link href={`/projects/${row.Project.id}/workflows`}>{row.Project.name}</Link>
                    </td>
                    <td>
                      <HealthBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </Shell>
  );
}

export default function WorkflowsPage() {
  return (
    <Suspense fallback={<Shell><Header title="Workflows" /><p>Loading…</p></Shell>}>
      <WorkflowsPageContent />
    </Suspense>
  );
}
