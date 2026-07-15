"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Header } from "../../components/layout/header";
import { Shell } from "../../components/layout/shell";
import { EmptyState } from "../../components/ui/empty-state";
import { apiFetch } from "../../lib/api";

const modes = ["AGENTLESS", "HEARTBEAT", "WEBHOOK", "API", "SYNTHETIC", "OTEL_COLLECTOR", "SDK", "CLOUD_CONNECTOR", "DATABASE_CONNECTOR", "CUSTOM_CONNECTOR"];

type Project = { id: string; name: string };
type Connection = {
  id: string; name: string; type: string; mode: string; environment: string; authMethod: string;
  health: string; installationStatus: string; project: Project | null; secretConfigured: boolean; lastError: string | null;
  capabilities: string[]; manifestVersion: string; deactivatedAt: string | null; isActive: boolean;
};
type Manifest = {
  version: string; displayName: string; requiredCapabilities: string[]; supportedAuthMethods: string[]; availableCapabilities: string[];
  configurationSchema: Array<{ key: string; label: string; type: "url" | "string" | "number" | "select"; required?: boolean; description?: string; options?: string[] }>;
  foundationHooks: Array<{ key: string; supported: false; reason: string }>;
};
type LedgerEntry = { id: string; kind: string; summary: string; source: string; occurredAt: string; project: Project | null; connection: { id: string; name: string } | null };

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState("AGENTLESS");
  const [authMethod, setAuthMethod] = useState("NONE");
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [testingId, setTestingId] = useState<string | null>(null);
  const availableAuthMethods = manifest?.supportedAuthMethods ?? ["NONE"];

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [connectionRows, projectRows, ledgerRows] = await Promise.all([
        apiFetch<Connection[]>("/connections"),
        apiFetch<Project[]>("/projects"),
        apiFetch<LedgerEntry[]>("/change-ledger?limit=10")
      ]);
      setConnections(connectionRows);
      setProjects(projectRows);
      setLedger(ledgerRows);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load connections");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    let cancelled = false;
    apiFetch<Manifest>(`/connections/manifests/${mode}`)
      .then((next) => {
        if (cancelled) return;
        setManifest(next);
        setAuthMethod(next.supportedAuthMethods[0] ?? "NONE");
        setCapabilities(next.requiredCapabilities);
      })
      .catch((manifestError) => {
        if (!cancelled) setError(manifestError instanceof Error ? manifestError.message : "Failed to load connector manifest");
      });
    return () => { cancelled = true; };
  }, [mode]);

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
          secretRef: fields.get("secretRef") || undefined,
          configuration: Object.fromEntries(
            (manifest?.configurationSchema ?? [])
              .map((field) => [field.key, fields.get(`configuration.${field.key}`)])
              .filter(([, value]) => typeof value === "string" && value.trim() !== "")
          )
        })
      });
      event.currentTarget.reset();
      setMode("AGENTLESS");
      setAuthMethod("NONE");
      setCapabilities([]);
      setShowForm(false);
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create connection");
    } finally {
      setSubmitting(false);
    }
  };

  const testConnection = async (connectionId: string) => {
    setTestingId(connectionId);
    setError(null);
    try {
      await apiFetch(`/connections/${connectionId}/test`, { method: "POST" });
      await load();
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "Connection test failed");
      await load();
    } finally {
      setTestingId(null);
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
          <p className="dashboard-subtle">Select a connector contract and secure credential reference. A configured connection is not reported healthy until a real validation succeeds.</p>
          <form onSubmit={submit} className="form-row">
            <label>Name<input name="name" required maxLength={120} /></label>
            <label>Type<input name="type" required placeholder="Public API, storefront health…" maxLength={120} /></label>
            <label>Mode
              <select value={mode} onChange={(event) => setMode(event.target.value)}>
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
            <label>Secure credential reference<input name="secretRef" placeholder="env://WEBHOOK_SECRET" maxLength={300} /></label>
            {manifest?.configurationSchema.map((field) => (
              <label key={field.key}>{field.label}
                {field.type === "select" ? (
                  <select name={`configuration.${field.key}`} defaultValue={field.options?.[0] ?? ""}>
                    {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : (
                  <input name={`configuration.${field.key}`} type={field.type} required={field.required} min={field.type === "number" ? 1 : undefined} max={field.type === "number" ? 30000 : undefined} />
                )}
                {field.description ? <small>{field.description}</small> : null}
              </label>
            ))}
            {manifest ? (
              <fieldset>
                <legend>{manifest.displayName} capabilities (v{manifest.version})</legend>
                {manifest.availableCapabilities.map((capability) => (
                  <label key={capability}>
                    <input
                      type="checkbox"
                      checked={capabilities.includes(capability)}
                      disabled={manifest.requiredCapabilities.includes(capability)}
                      onChange={(event) => setCapabilities((current) => event.target.checked ? [...new Set([...current, capability])] : current.filter((value) => value !== capability))}
                    />
                    {capability}{manifest.requiredCapabilities.includes(capability) ? " (required)" : ""}
                  </label>
                ))}
              </fieldset>
            ) : null}
            <div className="form-actions"><button className="secondary-button" type="button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary-button" disabled={submitting}>{submitting ? "Saving…" : "Save connection"}</button></div>
          </form>
          {manifest?.foundationHooks.length ? <p className="dashboard-subtle">Not implemented: {manifest.foundationHooks.map((hook) => hook.key).join(", ")}. They are not advertised as capabilities.</p> : null}
        </section>
      ) : null}
      <section className="panel">
        <h2>Connection registry</h2>
        {loading ? <p aria-busy="true">Loading connections…</p> : connections.length === 0 ? (
          <EmptyState title="No connections configured" description="Add an agentless, API, webhook, collector, or custom connection to begin registering operational evidence." action={<button type="button" className="primary-button" onClick={() => setShowForm(true)}>Add connection</button>} />
        ) : (
          <div className="table-cards-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Mode</th><th>Capabilities</th><th>Application</th><th>Health</th><th>Installation</th><th>Credentials</th><th>Actions</th></tr></thead>
            <tbody>{connections.map((connection) => <tr key={connection.id}><td data-label="Name">{connection.name}<small>{connection.type} · manifest v{connection.manifestVersion}</small></td><td data-label="Mode">{connection.mode}</td><td data-label="Capabilities">{connection.capabilities.join(", ") || "None"}</td><td data-label="Application">{connection.project?.name ?? "Organization-wide"}</td><td data-label="Health">{connection.health}</td><td data-label="Installation">{connection.installationStatus}</td><td data-label="Credentials">{connection.secretConfigured ? "Secure reference configured" : "None"}</td><td data-label="Actions">{["AGENTLESS", "API"].includes(connection.mode) ? <button className="secondary-button" type="button" disabled={testingId === connection.id || !connection.isActive} onClick={() => void testConnection(connection.id)}>{testingId === connection.id ? "Testing…" : "Test"}</button> : "No runtime test"}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>
      <section className="panel">
        <h2>Universal change ledger</h2>
        <p className="dashboard-subtle">Only recorded deployment, configuration, topology, automation, migration, and connection validation evidence appears here.</p>
        {ledger.length === 0 ? <p>No recorded changes for this organization.</p> : <div className="table-cards-wrap"><table className="data-table"><thead><tr><th>When</th><th>Kind</th><th>Change</th><th>Source</th></tr></thead><tbody>{ledger.map((entry) => <tr key={entry.id}><td data-label="When">{new Date(entry.occurredAt).toLocaleString()}</td><td data-label="Kind">{entry.kind}</td><td data-label="Change">{entry.summary}<small>{entry.project?.name ?? entry.connection?.name ?? "Organization-wide"}</small></td><td data-label="Source">{entry.source}</td></tr>)}</tbody></table></div>}
      </section>
    </Shell>
  );
}
