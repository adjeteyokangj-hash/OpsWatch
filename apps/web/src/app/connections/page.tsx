"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Header } from "../../components/layout/header";
import { Shell } from "../../components/layout/shell";
import { EmptyState } from "../../components/ui/empty-state";
import { apiFetch } from "../../lib/api";

const modes = ["AGENTLESS", "HEARTBEAT", "WEBHOOK", "API", "SYNTHETIC", "OTEL_COLLECTOR", "SDK", "CLOUD_CONNECTOR", "DATABASE_CONNECTOR", "CUSTOM_CONNECTOR"];
const authMethods: Record<string, string[]> = {
  AGENTLESS: ["NONE", "BASIC", "BEARER", "HEADER"], HEARTBEAT: ["HMAC", "API_KEY"], WEBHOOK: ["HMAC", "API_KEY"],
  API: ["NONE", "BASIC", "BEARER", "HEADER", "OAUTH2"], SYNTHETIC: ["NONE"], OTEL_COLLECTOR: ["API_KEY", "MTLS"],
  SDK: ["API_KEY", "HMAC"], CLOUD_CONNECTOR: ["OAUTH2", "API_KEY"], DATABASE_CONNECTOR: ["BASIC", "API_KEY", "MTLS"],
  CUSTOM_CONNECTOR: ["NONE", "API_KEY", "HMAC", "OAUTH2", "MTLS"]
};
const requiredCapabilities: Record<string, string[]> = {
  AGENTLESS: ["health_check"], HEARTBEAT: ["heartbeat"], WEBHOOK: ["event_ingest"], API: ["api_probe"],
  SYNTHETIC: ["synthetic_run"], OTEL_COLLECTOR: ["telemetry_ingest"], SDK: ["event_ingest"],
  CLOUD_CONNECTOR: ["cloud_read"], DATABASE_CONNECTOR: ["database_probe"], CUSTOM_CONNECTOR: []
};

type Project = { id: string; name: string };
type Connection = {
  id: string; name: string; type: string; mode: string; environment: string; authMethod: string;
  health: string; installationStatus: string; project: Project | null; secretConfigured: boolean; lastError: string | null;
};

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState("AGENTLESS");
  const [authMethod, setAuthMethod] = useState("NONE");
  const availableAuthMethods = authMethods[mode] ?? ["NONE"];
  const capabilities = requiredCapabilities[mode] ?? [];

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [connectionRows, projectRows] = await Promise.all([apiFetch<Connection[]>("/connections"), apiFetch<Project[]>("/projects")]);
      setConnections(connectionRows);
      setProjects(projectRows);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load connections");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/connections", {
        method: "POST",
        body: JSON.stringify({
          name: fields.get("name"),
          type: fields.get("type"),
          mode,
          environment: fields.get("environment") || "production",
          authMethod: fields.get("authMethod") || "NONE",
          capabilities,
          projectId: fields.get("projectId") || undefined,
          secretRef: fields.get("secretRef") || undefined
        })
      });
      event.currentTarget.reset();
      setMode("AGENTLESS");
      setAuthMethod("NONE");
      setShowForm(false);
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create connection");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Shell>
      <Header
        title="Connections"
        description="Configure evidence-producing operational connections. Credentials are stored as existing secure references, never entered into this form."
        actions={<button type="button" className="primary-button" onClick={() => setShowForm(true)}>+ Add connection</button>}
      />
      {error ? <section className="panel error-panel" role="alert">{error}</section> : null}
      {showForm ? (
        <section className="panel" aria-label="Add connection">
          <h2>Add connection</h2>
          <p className="dashboard-subtle">Select a mode and secure credential reference. A configured connection is not reported healthy until a connector records a successful validation.</p>
          <form onSubmit={submit} className="form-row">
            <label>Name<input name="name" required maxLength={120} /></label>
            <label>Type<input name="type" required placeholder="HTTP endpoint, cloud account…" maxLength={120} /></label>
            <label>Mode
              <select value={mode} onChange={(event) => { const next = event.target.value; setMode(next); setAuthMethod(authMethods[next]?.[0] ?? "NONE"); }}>
                {modes.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>Authentication
              <select name="authMethod" value={authMethod} onChange={(event) => setAuthMethod(event.target.value)}>
                {availableAuthMethods.map((value) => <option key={value} value={value}>{value.replace("_", " ")}</option>)}
              </select>
            </label>
            <label>Application
              <select name="projectId" defaultValue=""><option value="">Organization-wide</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
            </label>
            <label>Environment<input name="environment" defaultValue="production" maxLength={80} /></label>
            <label>Secure credential reference<input name="secretRef" placeholder="vault://…" maxLength={300} /></label>
            <div className="form-actions"><button className="secondary-button" type="button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary-button" disabled={submitting}>{submitting ? "Saving…" : "Save connection"}</button></div>
          </form>
        </section>
      ) : null}
      <section className="panel">
        <h2>Connection registry</h2>
        {loading ? <p aria-busy="true">Loading connections…</p> : connections.length === 0 ? (
          <EmptyState title="No connections configured" description="Add an agentless, API, webhook, collector, or custom connection to begin registering operational evidence." action={<button type="button" className="primary-button" onClick={() => setShowForm(true)}>Add connection</button>} />
        ) : (
          <div className="table-cards-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Mode</th><th>Application</th><th>Health</th><th>Installation</th><th>Credentials</th></tr></thead>
            <tbody>{connections.map((connection) => <tr key={connection.id}><td data-label="Name">{connection.name}<small>{connection.type}</small></td><td data-label="Mode">{connection.mode}</td><td data-label="Application">{connection.project?.name ?? "Organization-wide"}</td><td data-label="Health">{connection.health}</td><td data-label="Installation">{connection.installationStatus}</td><td data-label="Credentials">{connection.secretConfigured ? "Secure reference configured" : "None"}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>
    </Shell>
  );
}
