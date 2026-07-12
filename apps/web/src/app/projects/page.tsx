"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { apiFetch } from "../../lib/api";
import { ProjectsTable } from "../../components/projects/projects-table";
import { StatCard } from "../../components/dashboard/stat-card";
import { API_BASE_URL } from "../../lib/constants";

type IngestCredentials = {
  apiKey?: string;
  signingSecret?: string;
  projectSlug?: string;
  scopes?: string[];
  reused?: boolean;
  error?: string;
};

type CreateProjectResponse = {
  id: string;
  name: string;
  slug: string;
  ingestCredentials?: IngestCredentials;
};

const EMPTY_FORM = {
  name: "",
  slug: "",
  clientName: "",
  environment: "production",
  frontendUrl: "",
  backendUrl: "",
  repoUrl: "",
  description: "",
  projectOwner: "",
  operationalContact: "",
  defaultRegion: "",
  plan: "FREE",
  monthlyPrice: 0,
  currency: "GBP",
  automationMode: "OBSERVE"
};

function ProjectsPageContent() {
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{
    projectName: string;
    credentials: IngestCredentials;
  } | null>(null);

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
      const created = await apiFetch<CreateProjectResponse>("/projects", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          slug: form.slug,
          clientName: form.clientName,
          environment: form.environment,
          description: form.description || undefined,
          frontendUrl: form.frontendUrl || undefined,
          backendUrl: form.backendUrl || undefined,
          repoUrl: form.repoUrl || undefined,
          projectOwner: form.projectOwner || undefined,
          operationalContact: form.operationalContact || undefined,
          defaultRegion: form.defaultRegion || undefined,
          automationMode: form.automationMode,
          billing: {
            plan: form.plan,
            monthlyPrice: form.monthlyPrice,
            currency: form.currency
          }
        })
      });
      if (created.ingestCredentials && !created.ingestCredentials.error) {
        setCreatedCredentials({
          projectName: created.name,
          credentials: created.ingestCredentials
        });
      } else if (created.ingestCredentials?.error) {
        setError(created.ingestCredentials.error);
      }
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
  const awaitingCount = projects.filter((row) => row.status === "UNKNOWN").length;
  const pausedCount = projects.filter((row) => row.status === "PAUSED").length;
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
        <StatCard label="Awaiting monitoring" value={awaitingCount} href="/projects?health=UNKNOWN" />
        <StatCard label="Paused" value={pausedCount} href="/projects?health=PAUSED" />
      </section>
      <section className="grid-6">
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
            <h3>Billing</h3>
            <div className="form-row">
              <label>
                Plan
                <select value={form.plan} onChange={(event) => setForm((current) => ({ ...current, plan: event.target.value }))}>
                  <option value="FREE">Free</option>
                  <option value="STARTER">Starter</option>
                  <option value="PRO">Pro</option>
                  <option value="ENTERPRISE">Enterprise</option>
                  <option value="CUSTOM">Custom</option>
                </select>
              </label>
              <label>
                Monthly price
                <input type="number" value={form.monthlyPrice} onChange={(event) => setForm((current) => ({ ...current, monthlyPrice: Number(event.target.value) }))} />
              </label>
              <label>
                Currency
                <input value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))} />
              </label>
            </div>
            <h3>Automation policy</h3>
            <label>
              Mode
              <select value={form.automationMode} onChange={(event) => setForm((current) => ({ ...current, automationMode: event.target.value }))}>
                <option value="OBSERVE">Observe only</option>
                <option value="APPROVAL">Approval required</option>
                <option value="AUTONOMOUS">Autonomous (policy permitting)</option>
              </select>
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
      {createdCredentials ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Project ingest credentials">
          <section className="modal-panel" style={{ maxWidth: "640px" }}>
            <div className="section-head">
              <div>
                <h2>Ingest credentials ready</h2>
                <p>
                  {createdCredentials.credentials.reused
                    ? `${createdCredentials.projectName} already has an active ingest key. Use the signing secret below with your existing API key.`
                    : `${createdCredentials.projectName} is ready for live heartbeats and events.`}
                </p>
              </div>
              <button type="button" className="secondary-button" onClick={() => setCreatedCredentials(null)} data-action="local-ui">
                Close
              </button>
            </div>
            <div className="stack-form">
              {!createdCredentials.credentials.reused && createdCredentials.credentials.apiKey ? (
                <label>
                  API key
                  <input value={createdCredentials.credentials.apiKey} readOnly />
                </label>
              ) : null}
              {createdCredentials.credentials.signingSecret ? (
                <label>
                  Signing secret
                  <input value={createdCredentials.credentials.signingSecret} readOnly />
                </label>
              ) : null}
              {createdCredentials.credentials.projectSlug ? (
                <label>
                  Project slug
                  <input value={createdCredentials.credentials.projectSlug} readOnly />
                </label>
              ) : null}
              {createdCredentials.credentials.apiKey && createdCredentials.credentials.signingSecret ? (
                <label>
                  Noble / client env snippet
                  <textarea
                    readOnly
                    rows={7}
                    value={`OPSWATCH_API_URL=${API_BASE_URL}
NOBLE_API_KEY=${createdCredentials.credentials.apiKey}
NOBLE_SIGNING_SECRET=${createdCredentials.credentials.signingSecret}
NOBLE_EXPRESS_PROJECT_SLUG=${createdCredentials.credentials.projectSlug}`}
                  />
                </label>
              ) : null}
              {!createdCredentials.credentials.reused && createdCredentials.credentials.apiKey ? (
                <button
                  type="button"
                  className="primary-button"
                  data-action="local-ui"
                  onClick={() =>
                    void navigator.clipboard.writeText(createdCredentials.credentials.apiKey ?? "")
                  }
                >
                  Copy API key
                </button>
              ) : null}
              <p className="warn-text">Store these credentials securely. The API key is shown only once.</p>
            </div>
          </section>
        </div>
      ) : null}
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
