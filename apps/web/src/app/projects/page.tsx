"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { apiFetch } from "../../lib/api";
import { ProjectsTable } from "../../components/projects/projects-table";
import { StatCard } from "../../components/dashboard/stat-card";

const EMPTY_FORM = {
  name: "",
  slug: "",
  clientName: "",
  environment: "production",
  frontendUrl: "",
  backendUrl: "",
  repoUrl: "",
  description: ""
};

function ProjectsPageContent() {
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiFetch<any[]>("/projects");
      setProjects(rows);
    } catch (err: any) {
      setError(err?.message || "Failed to load projects");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const updateName = (value: string) => {
    const slug = value.toLowerCase().trim().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    setForm((current) => ({ ...current, name: value, slug: current.slug || slug }));
  };

  const createProject = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/projects", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          slug: form.slug,
          clientName: form.clientName,
          environment: form.environment,
          description: form.description || undefined,
          frontendUrl: form.frontendUrl || undefined,
          backendUrl: form.backendUrl || undefined,
          repoUrl: form.repoUrl || undefined
        })
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to create project");
    } finally {
      setSaving(false);
    }
  };

  const healthFilter = searchParams.get("health");
  const filtered = healthFilter ? projects.filter((row) => row.status === healthFilter) : projects;
  const healthyCount = projects.filter((row) => row.status === "HEALTHY").length;
  const degradedCount = projects.filter((row) => row.status === "DEGRADED").length;
  const downCount = projects.filter((row) => row.status === "DOWN").length;
  const openAlerts = projects.reduce((sum, row) => sum + ((row.alerts || []).length || 0), 0);
  const unresolvedIncidents = projects.reduce(
    (sum, row) => sum + ((row.incidents || []).filter((incident: any) => incident.status !== "RESOLVED").length || 0),
    0
  );

  return (
    <Shell>
      <Header title="Projects" actions={!showForm ? <button type="button" className="primary-button" onClick={() => setShowForm(true)} data-action="local-ui">+ New project</button> : null} />
      {healthFilter ? <section className="panel">Showing only <strong>{healthFilter}</strong> projects.</section> : null}
      <section className="grid-6">
        <StatCard label="Projects" value={projects.length} href="/projects" />
        <StatCard label="Healthy" value={healthyCount} href="/projects?health=HEALTHY" />
        <StatCard label="Degraded" value={degradedCount} href="/projects?health=DEGRADED" />
        <StatCard label="Down" value={downCount} href="/projects?health=DOWN" />
        <StatCard label="Open alerts" value={openAlerts} href="/alerts?status=OPEN" />
        <StatCard label="Unresolved incidents" value={unresolvedIncidents} href="/incidents?onlyUnresolved=true" />
      </section>
      {error ? <section className="panel error-panel">{error}</section> : null}
      {showForm ? (
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Create project</h2>
              <p>Start fresh with a new monitored app.</p>
            </div>
            <button type="button" className="secondary-button" onClick={() => setShowForm(false)} data-action="local-ui">Cancel</button>
          </div>
          <form className="stack-form" onSubmit={(event) => void createProject(event)}>
            <div className="form-row">
              <label>
                Project name
                <input value={form.name} onChange={(event) => updateName(event.target.value)} placeholder="Sparkle" required />
              </label>
              <label>
                Slug
                <input
                  value={form.slug}
                  onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-") }))}
                  placeholder="sparkle"
                  required
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Client name
                <input value={form.clientName} onChange={(event) => setForm((current) => ({ ...current, clientName: event.target.value }))} placeholder="Internal" required />
              </label>
              <label>
                Environment
                <select value={form.environment} onChange={(event) => setForm((current) => ({ ...current, environment: event.target.value }))}>
                  <option value="production">Production</option>
                  <option value="staging">Staging</option>
                  <option value="development">Development</option>
                </select>
              </label>
            </div>
            <label>
              Description
              <input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="What this project monitors" />
            </label>
            <div className="form-row">
              <label>
                Frontend URL
                <input value={form.frontendUrl} onChange={(event) => setForm((current) => ({ ...current, frontendUrl: event.target.value }))} placeholder="https://example.com" />
              </label>
              <label>
                Backend URL
                <input value={form.backendUrl} onChange={(event) => setForm((current) => ({ ...current, backendUrl: event.target.value }))} placeholder="https://api.example.com/health" />
              </label>
            </div>
            <label>
              Repository URL
              <input value={form.repoUrl} onChange={(event) => setForm((current) => ({ ...current, repoUrl: event.target.value }))} placeholder="https://github.com/..." />
            </label>
            <button className="primary-button" type="submit" disabled={saving} data-action="api" data-endpoint="/projects">{saving ? "Creating..." : "Create project"}</button>
          </form>
        </section>
      ) : null}
      {loading ? (
        <section className="panel">Loading projects...</section>
      ) : filtered.length === 0 ? (
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>No matching projects.</h2>
              <p>Create a project or adjust filters to continue operational review.</p>
            </div>
            <button type="button" className="primary-button" onClick={() => setShowForm(true)} data-action="local-ui">+ New project</button>
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
    <Suspense fallback={<Shell><Header title="Projects" /><section className="panel">Loading projects...</section></Shell>}>
      <ProjectsPageContent />
    </Suspense>
  );
}
