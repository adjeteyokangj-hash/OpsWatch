"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { apiFetch } from "../../lib/api";
import { ProjectsTable } from "../../components/projects/projects-table";
import { StatCard } from "../../components/dashboard/stat-card";

function AppsPageContent() {
  const searchParams = useSearchParams();
  const healthFilter = searchParams.get("health");
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const rows = await apiFetch<any[]>("/projects");
        setProjects(rows);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const filtered = healthFilter
    ? projects.filter((row) => row.status === healthFilter)
    : projects;

  const healthy = projects.filter((p) => p.status === "HEALTHY").length;
  const degraded = projects.filter((p) => p.status === "DEGRADED").length;
  const down = projects.filter((p) => p.status === "DOWN").length;

  return (
    <Shell>
      <Header title="Applications" />
      <p className="dashboard-subtle">Application-layer health across your monitored estate.</p>
      <section className="grid-4">
        <StatCard label="Applications" value={loading ? "-" : projects.length} href="/apps" />
        <StatCard label="Healthy" value={loading ? "-" : healthy} href="/apps?health=HEALTHY" />
        <StatCard label="Degraded" value={loading ? "-" : degraded} href="/apps?health=DEGRADED" />
        <StatCard label="Down" value={loading ? "-" : down} href="/apps?health=DOWN" />
      </section>
      {loading ? <p>Loading applications…</p> : null}
      {!loading ? (
        <section className="panel">
          <h2>{healthFilter ? `Filtered: ${healthFilter}` : "All applications"}</h2>
          <ProjectsTable rows={filtered} />
        </section>
      ) : null}
    </Shell>
  );
}

export default function AppsPage() {
  return (
    <Suspense fallback={<Shell><Header title="Applications" /><p>Loading…</p></Shell>}>
      <AppsPageContent />
    </Suspense>
  );
}
