"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Header } from "../../components/layout/header";
import { Shell } from "../../components/layout/shell";
import { EmptyState } from "../../components/ui/empty-state";
import { apiFetch } from "../../lib/api";

const modes = ["AGENTLESS", "HEARTBEAT", "WEBHOOK", "API", "SYNTHETIC", "OTEL_COLLECTOR", "SDK", "CLOUD_CONNECTOR", "DATABASE_CONNECTOR", "CUSTOM_CONNECTOR"];
const provenanceFilters = ["ALL", "DECLARED", "DISCOVERED", "LEARNED"] as const;

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
  otelIngestionEnabled?: boolean;
};
type LedgerEntry = { id: string; kind: string; summary: string; source: string; occurredAt: string; project: Project | null; connection: { id: string; name: string } | null };
type GraphEntity = {
  id: string; name: string; entityType: string; health: string; healthReason: string | null; provenance: string;
};
type GraphRelationship = {
  id: string; sourceEntityId: string; targetEntityId: string; relationshipType: string; provenance: string;
  approvalStatus: string; impactRole?: string; requiresApproval?: boolean; confidence: number | null;
};
type GraphResponse = {
  entities: GraphEntity[];
  relationships: GraphRelationship[];
  filters?: { learnedTopologyEnabled?: boolean };
};
type HealthExplanation = {
  entityId: string; currentHealth: string; reason: string; dependencyCause: string | null; confidence: number;
};
type HealthSnapshot = {
  organization: { health: string; topologyMode: string; reason: string };
  entities: HealthExplanation[];
  calculatedAt: string;
};

const safeReturnPath = (value: string | null): string | null => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
};

function ConnectionsPageContent() {
  const searchParams = useSearchParams();
  const returnTo = safeReturnPath(searchParams.get("returnTo"));
  const scopedProjectId = searchParams.get("projectId") || "";
  const edgeId = searchParams.get("edgeId");

  const [connections, setConnections] = useState<Connection[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(Boolean(scopedProjectId));
  const [mode, setMode] = useState("AGENTLESS");
  const [authMethod, setAuthMethod] = useState("NONE");
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [provenanceFilter, setProvenanceFilter] = useState<(typeof provenanceFilters)[number]>("ALL");
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const availableAuthMethods = manifest?.supportedAuthMethods ?? ["NONE"];

  const entityNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const entity of graph?.entities ?? []) map.set(entity.id, entity.name);
    return map;
  }, [graph]);

  const pendingLearned = useMemo(
    () => (graph?.relationships ?? []).filter((row) => row.provenance === "LEARNED" && row.approvalStatus === "PENDING"),
    [graph]
  );

  const healthByEntityId = useMemo(() => {
    const map = new Map<string, HealthExplanation>();
    for (const row of health?.entities ?? []) map.set(row.entityId, row);
    return map;
  }, [health]);

  const scopedProjectName = useMemo(
    () => projects.find((row) => row.id === scopedProjectId)?.name ?? null,
    [projects, scopedProjectId]
  );

  const loadTopology = async (provenance: (typeof provenanceFilters)[number]) => {
    const query = new URLSearchParams({ includePendingLearned: "true" });
    if (provenance !== "ALL") query.set("provenance", provenance);
    const [graphRows, healthRows] = await Promise.all([
      apiFetch<GraphResponse>(`/operational-graph?${query.toString()}`),
      apiFetch<HealthSnapshot>("/operational-graph/health")
    ]);
    setGraph(graphRows);
    setHealth(healthRows);
  };

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
      await loadTopology(provenanceFilter);
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

  useEffect(() => {
    if (loading) return;
    void loadTopology(provenanceFilter).catch((topologyError) => {
      setError(topologyError instanceof Error ? topologyError.message : "Failed to load operational graph");
    });
  }, [provenanceFilter]);

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
      if (returnTo) {
        window.location.assign(returnTo);
      }
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

  const reviewLearned = async (relationshipId: string, decision: "APPROVE" | "REJECT" | "IGNORE") => {
    setReviewingId(relationshipId);
    setError(null);
    try {
      await apiFetch(`/operational-relationships/${relationshipId}/review`, {
        method: "POST",
        body: JSON.stringify({ decision })
      });
      await loadTopology(provenanceFilter);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Failed to review learned relationship");
    } finally {
      setReviewingId(null);
    }
  };

  return (
    <Shell>
      <Header
        title="Connections"
        description="Configure evidence-producing operational connections. Credentials are stored as existing secure references, never entered into this form."
        actions={<button type="button" className="primary-button" onClick={() => setShowForm(true)}>+ Add connection</button>}
      />
      {returnTo ? (
        <aside className="notice-panel" role="status" data-testid="connections-return-banner">
          <strong>Return to topology</strong>
          <p>
            {scopedProjectName
              ? `Configuring connections for ${scopedProjectName}${edgeId ? ` · relationship ${edgeId}` : ""}.`
              : "You came here from a topology relationship that needs a provider."}{" "}
            After saving, OpsWatch can send you back to finish the Fix with automation journey.
          </p>
          <Link className="secondary-button" href={returnTo} data-testid="connections-return-link">
            ← Back to topology
          </Link>
        </aside>
      ) : null}
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
              <select name="projectId" defaultValue={scopedProjectId}>
                <option value="">Organization-wide</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
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
          {mode === "OTEL_COLLECTOR" && manifest?.otelIngestionEnabled === false ? (
            <aside className="notice-panel" role="status">
              <strong>Collector ingestion is disabled</strong>
              <p>Setup details are available now, but the bridge refuses telemetry until an administrator sets <code>OPSWATCH_OTEL_INGESTION_ENABLED=true</code>. Configure a secure credential reference and use the documented official Collector bridge endpoint; OpsWatch does not expose a native OTLP server.</p>
            </aside>
          ) : null}
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
      <section className="panel" aria-label="Operational topology">
        <h2>Operational topology</h2>
        <p className="dashboard-subtle">
          Declared, discovered, and learned graph edges with rolled-up health. Pending learned relationships stay inactive until approved.
          {graph?.filters?.learnedTopologyEnabled === false ? " Observation auto-discovery is off (OPSWATCH_LEARNED_TOPOLOGY_ENABLED)." : null}
        </p>
        <div className="form-actions" style={{ marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
          {provenanceFilters.map((value) => (
            <button
              key={value}
              type="button"
              className={provenanceFilter === value ? "primary-button" : "secondary-button"}
              onClick={() => setProvenanceFilter(value)}
            >
              {value === "ALL" ? "All provenance" : value.charAt(0) + value.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        {health ? (
          <aside className="notice-panel" role="status" style={{ marginBottom: "1rem" }}>
            <strong>Org health: {health.organization.health}</strong>
            <p>{health.organization.reason} · mode {health.organization.topologyMode} · calculated {new Date(health.calculatedAt).toLocaleString()}</p>
          </aside>
        ) : null}
        {pendingLearned.length > 0 ? (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Pending learned approvals</h3>
            <div className="table-cards-wrap">
              <table className="data-table">
                <thead><tr><th>Edge</th><th>Role</th><th>Confidence</th><th>Actions</th></tr></thead>
                <tbody>
                  {pendingLearned.map((relationship) => (
                    <tr key={relationship.id}>
                      <td data-label="Edge">
                        {entityNameById.get(relationship.sourceEntityId) ?? relationship.sourceEntityId}
                        {" → "}
                        {entityNameById.get(relationship.targetEntityId) ?? relationship.targetEntityId}
                        <small>{relationship.relationshipType}</small>
                      </td>
                      <td data-label="Role">{relationship.impactRole ?? "REQUIRED"}</td>
                      <td data-label="Confidence">{relationship.confidence ?? "—"}</td>
                      <td data-label="Actions">
                        <button type="button" className="primary-button" disabled={reviewingId === relationship.id} onClick={() => void reviewLearned(relationship.id, "APPROVE")}>Approve</button>{" "}
                        <button type="button" className="secondary-button" disabled={reviewingId === relationship.id} onClick={() => void reviewLearned(relationship.id, "REJECT")}>Reject</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="dashboard-subtle">No pending learned relationships.</p>
        )}
        {(graph?.entities.length ?? 0) === 0 ? (
          <p>No operational entities for this filter.</p>
        ) : (
          <div className="table-cards-wrap">
            <table className="data-table">
              <thead><tr><th>Entity</th><th>Provenance</th><th>Health</th><th>Reason</th></tr></thead>
              <tbody>
                {graph?.entities.map((entity) => {
                  const rolled = healthByEntityId.get(entity.id);
                  return (
                    <tr key={entity.id}>
                      <td data-label="Entity">{entity.name}<small>{entity.entityType}</small></td>
                      <td data-label="Provenance">{entity.provenance}</td>
                      <td data-label="Health">{rolled?.currentHealth ?? entity.health}</td>
                      <td data-label="Reason">{rolled?.reason ?? entity.healthReason ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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

export default function ConnectionsPage() {
  return (
    <Suspense fallback={<Shell><Header title="Connections" /><section className="panel">Loading connections...</section></Shell>}>
      <ConnectionsPageContent />
    </Suspense>
  );
}
