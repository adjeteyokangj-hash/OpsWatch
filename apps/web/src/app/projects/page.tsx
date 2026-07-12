"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { apiFetch } from "../../lib/api";
import { ProjectsTable } from "../../components/projects/projects-table";
import { RegisterApplicationWizard } from "../../components/projects/register-application-wizard";
import { StatCard } from "../../components/dashboard/stat-card";

function ProjectsPageContent() {
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiFetch<any[]>("/projects");
      setProjects(rows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const healthFilter = searchParams.get("health");
  const filtered = healthFilter ? projects.filter((row) => row.status === healthFilter) : projects;
  const healthyCount = projects.filter((row) => row.status === "HEALTHY").length;
  const degradedCount = projects.filter((row) => row.status === "DEGRADED").length;
  const downCount = projects.filter((row) => row.status === "DOWN").length;
  const awaitingCount = projects.filter((row) => row.status === "UNKNOWN").length;
  const pausedCount = projects.filter((row) => row.status === "PAUSED").length;
  const openAlerts = projects.reduce((sum, row) => sum + ((row.alerts || []).length || 0), 0);
  const unresolvedIncidents = projects.reduce(
    (sum, row) => sum + ((row.incidents || []).filter((incident: any) => incident.status !== "RESOLVED").length || 0),
    0
  );
  const knownClients = projects.map((row) => row.clientName as string | undefined);

  return (
    <Shell>
      <Header
        title="Applications"
        actions={
          !showWizard ? (
            <button type="button" className="primary-button" onClick={() => setShowWizard(true)} data-action="local-ui">
              + Register application
            </button>
          ) : null
        }
      />
      {healthFilter ? <section className="panel">Showing only <strong>{healthFilter}</strong> applications.</section> : null}
      <section className="grid-6">
        <StatCard label="Applications" value={projects.length} href="/projects" />
        <StatCard label="Healthy" value={healthyCount} href="/projects?health=HEALTHY" />
        <StatCard label="Degraded" value={degradedCount} href="/projects?health=DEGRADED" />
        <StatCard label="Down" value={downCount} href="/projects?health=DOWN" />
        <StatCard label="Awaiting monitoring" value={awaitingCount} href="/projects?health=UNKNOWN" />
        <StatCard label="Paused" value={pausedCount} href="/projects?health=PAUSED" />
      </section>
      <section className="grid-6">
        <StatCard label="Open alerts" value={openAlerts} href="/alerts?status=OPEN" />
        <StatCard label="Unresolved incidents" value={unresolvedIncidents} href="/incidents?onlyUnresolved=true" />
      </section>
      {error ? <section className="panel error-panel">{error}</section> : null}
      {showWizard ? (
        <RegisterApplicationWizard
          knownClients={knownClients}
          onClose={() => setShowWizard(false)}
          onCreated={load}
        />
      ) : null}
      {loading ? (
        <section className="panel">Loading applications...</section>
      ) : filtered.length === 0 ? (
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>No applications yet.</h2>
              <p>Register an application to establish a secure connection and start collecting health signals.</p>
            </div>
            <button type="button" className="primary-button" onClick={() => setShowWizard(true)} data-action="local-ui">
              + Register application
            </button>
          </div>
        </section>
      ) : (
        <ProjectsTable rows={filtered} />
      )}
    </Shell>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<Shell><Header title="Applications" /><section className="panel">Loading applications...</section></Shell>}>
      <ProjectsPageContent />
    </Suspense>
  );
}
