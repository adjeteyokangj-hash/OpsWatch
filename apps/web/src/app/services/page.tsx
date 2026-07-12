"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { HealthBadge } from "../../components/health/health-badge";
import { apiFetch } from "../../lib/api";

const componentTypes = new Set([
  "COMPONENT",
  "FRONTEND",
  "API",
  "DATABASE",
  "WORKER",
  "WEBHOOK",
  "EMAIL",
  "PAYMENT",
  "THIRD_PARTY"
]);

type ServiceRow = {
  id: string;
  name: string;
  type: string;
  status: string;
  isCritical: boolean;
  Project: { id: string; name: string };
};

const bucketStatus = (bucket: string | null, status: string): boolean => {
  if (!bucket) return true;
  if (bucket === "healthy") return status === "HEALTHY";
  if (bucket === "critical") return status === "DOWN";
  if (bucket === "warning") return ["DEGRADED", "RECOVERING", "MAINTENANCE", "PAUSED"].includes(status);
  if (bucket === "unknown") return status === "UNKNOWN";
  return status === bucket;
};

function ServicesPageContent() {
  const searchParams = useSearchParams();
  const layer = searchParams.get("layer");
  const health = searchParams.get("health");
  const [rows, setRows] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await apiFetch<ServiceRow[]>("/services");
        setRows(data);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (layer === "MODULE" && row.type !== "MODULE") return false;
      if (layer === "WORKFLOW" && row.type !== "WORKFLOW") return false;
      if (layer === "COMPONENT" && !componentTypes.has(row.type)) return false;
      if (layer && !["MODULE", "WORKFLOW", "COMPONENT"].includes(layer) && row.type !== layer) return false;
      return bucketStatus(health, row.status);
    });
  }, [rows, layer, health]);

  return (
    <Shell>
      <Header title="Services" />
      <p className="dashboard-subtle">Module, workflow, and component inventory across all applications.</p>
      <section className="pill-row">
        <Link className={!layer ? "pill active" : "pill"} href="/services">All</Link>
        <Link className={layer === "MODULE" ? "pill active" : "pill"} href="/services?layer=MODULE">Modules</Link>
        <Link className={layer === "WORKFLOW" ? "pill active" : "pill"} href="/services?layer=WORKFLOW">Workflows</Link>
        <Link className={layer === "COMPONENT" ? "pill active" : "pill"} href="/services?layer=COMPONENT">Components</Link>
      </section>
      {loading ? <p>Loading services…</p> : null}
      {!loading ? (
        <section className="panel">
          <h2>{filtered.length} service{filtered.length === 1 ? "" : "s"}</h2>
          <div className="layer-health-table-wrap">
            <table className="data-table layer-health-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Type</th>
                  <th>Application</th>
                  <th>Health</th>
                  <th>Critical</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.type}</td>
                    <td>
                      <Link href={`/projects/${row.Project.id}`}>{row.Project.name}</Link>
                    </td>
                    <td>
                      <HealthBadge status={row.status} />
                    </td>
                    <td>{row.isCritical ? "Yes" : "—"}</td>
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

export default function ServicesPage() {
  return (
    <Suspense fallback={<Shell><Header title="Services" /><p>Loading…</p></Shell>}>
      <ServicesPageContent />
    </Suspense>
  );
}
