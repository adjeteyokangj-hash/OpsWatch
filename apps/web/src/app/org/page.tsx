"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { apiFetch } from "../../lib/api";

type OrgData = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  isActive: boolean;
  _count: { users: number; projects: number };
};

type StatusPage = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  isPublic: boolean;
  project?: { id: string; name: string; slug: string } | null;
};

type ProjectOption = {
  id: string;
  name: string;
  slug: string;
};

type ApiKeyRow = {
  id: string;
  name: string;
  keyId: string;
  prefix: string;
  scopes: string[];
  environment: "live" | "test";
  project: { id: string; name: string } | null;
  lastUsedAt: string | null;
  lastUsedRoute: string | null;
  lastUsedIp: string | null;
  lastUsedUserAgent: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  requests24h: number;
  failedAttempts24h: number;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
};

type ApiKeyUsage = {
  last24hRequests: number;
  failedAuthAttempts: number;
  activeKeys: number;
};

type CreateApiKeyResponse = {
  id: string;
  keyId: string;
  key: string;
  prefix: string;
  name: string;
  scopes: string[];
  environment: "live" | "test";
  project: { id: string; name: string } | null;
  expiresAt: string | null;
  createdAt: string;
};

const KEY_SCOPES = [
  "events:write",
  "heartbeats:write",
  "alerts:read",
  "incidents:read"
] as const;

export default function OrgPage() {
  const router = useRouter();
  const [org, setOrg] = useState<OrgData | null>(null);
  const [statusPages, setStatusPages] = useState<StatusPage[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [apiUsage, setApiUsage] = useState<ApiKeyUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createKeyError, setCreateKeyError] = useState<string | null>(null);
  const [nameEdit, setNameEdit] = useState("");
  const [spForm, setSpForm] = useState({ title: "", slug: "", description: "", projectId: "", isPublic: true });
  const [showCreateKeyModal, setShowCreateKeyModal] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreateApiKeyResponse | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [createKeyForm, setCreateKeyForm] = useState({
    name: "Sparkle production ingest",
    environment: "live" as "live" | "test",
    scopes: ["events:write", "heartbeats:write"] as string[],
    projectId: "",
    expiresAt: ""
  });

  const asErrorMessage = (error: unknown): string => {
    if (error instanceof Error && error.message) return error.message;
    return "Unknown API error";
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [orgResult, spResult, projectsResult, apiKeysResult, apiUsageResult] = await Promise.allSettled([
        apiFetch<OrgData>("/org"),
        apiFetch<StatusPage[]>("/org/status-pages"),
        apiFetch<ProjectOption[]>("/projects"),
        apiFetch<ApiKeyRow[]>("/org/api-keys"),
        apiFetch<ApiKeyUsage>("/org/api-keys/usage")
      ]);

      if (orgResult.status === "rejected") {
        throw orgResult.reason;
      }

      if (projectsResult.status === "rejected") {
        throw projectsResult.reason;
      }

      const orgData = orgResult.value;
      const pData = projectsResult.value;
      const partialFailures: string[] = [];

      setOrg(orgData);
      setNameEdit(orgData.name);
      if (spResult.status === "fulfilled") {
        setStatusPages(spResult.value);
      } else {
        setStatusPages([]);
        partialFailures.push(`status pages (${asErrorMessage(spResult.reason)})`);
      }

      setProjects(pData);
      if (apiKeysResult.status === "fulfilled") {
        setApiKeys(apiKeysResult.value);
      } else {
        setApiKeys([]);
        partialFailures.push(`API keys (${asErrorMessage(apiKeysResult.reason)})`);
      }

      if (apiUsageResult.status === "fulfilled") {
        setApiUsage(apiUsageResult.value);
      } else {
        setApiUsage({ last24hRequests: 0, failedAuthAttempts: 0, activeKeys: 0 });
        partialFailures.push(`API key usage (${asErrorMessage(apiUsageResult.reason)})`);
      }

      setCreateKeyForm((prev) => {
        if (prev.projectId || pData.length === 0) return prev;
        const sparkle = pData.find((project) => project.slug === "sparkle" || project.name.toLowerCase().includes("sparkle"));
        const defaultProject = sparkle || pData[0];
        return defaultProject ? { ...prev, projectId: defaultProject.id } : prev;
      });

      if (partialFailures.length > 0) {
        setError(`Some organization sections could not load: ${partialFailures.join(", ")}`);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load organization");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSaveName = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<OrgData>("/org", {
        method: "PATCH",
        body: JSON.stringify({ name: nameEdit })
      });
      setOrg(updated);
    } catch (err: any) {
      setError(err?.message || "Failed to update organization");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateStatusPage = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await apiFetch<StatusPage>("/org/status-pages", {
        method: "POST",
        body: JSON.stringify({
          title: spForm.title,
          slug: spForm.slug,
          description: spForm.description || undefined,
          projectId: spForm.projectId || undefined,
          isPublic: spForm.isPublic
        })
      });
      setStatusPages((prev) => [created, ...prev]);
      setSpForm({ title: "", slug: "", description: "", projectId: "", isPublic: true });
      router.push(`/status-page/${created.id}`);
    } catch (err: any) {
      setError(err?.message || "Failed to create status page");
    } finally {
      setSaving(false);
    }
  };

  const refreshApiKeys = async () => {
    const [keyData, usageData] = await Promise.all([
      apiFetch<ApiKeyRow[]>("/org/api-keys"),
      apiFetch<ApiKeyUsage>("/org/api-keys/usage")
    ]);
    setApiKeys(keyData);
    setApiUsage(usageData);
  };

  const handleCreateApiKey = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setCreateKeyError(null);

    let expiresAtIso: string | undefined;
    if (createKeyForm.expiresAt) {
      const parsed = new Date(createKeyForm.expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        setCreateKeyError("Expiry date/time is invalid. Please pick a valid value.");
        return;
      }
      expiresAtIso = parsed.toISOString();
    }

    setCreatingKey(true);
    try {
      const payload: Record<string, unknown> = {
        name: createKeyForm.name,
        environment: createKeyForm.environment,
        scopes: createKeyForm.scopes,
        projectId: createKeyForm.projectId || undefined,
        expiresAt: expiresAtIso
      };

      const created = await apiFetch<CreateApiKeyResponse>("/org/api-keys", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      setCreatedKey(created);
      setCreateKeyError(null);
      await refreshApiKeys();
    } catch (err: any) {
      const message = err?.message || "Failed to create API key";
      setError(message);
      setCreateKeyError(message);
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeApiKey = async (id: string, reason: string) => {
    setError(null);
    try {
      await apiFetch(`/org/api-keys/${id}/revoke`, {
        method: "POST",
        body: JSON.stringify({ reason: reason || undefined })
      });
      setRevokeTarget(null);
      setRevokeReason("");
      await refreshApiKeys();
    } catch (err: any) {
      setError(err?.message || "Failed to revoke API key");
    }
  };

  const toggleScope = (scope: string) => {
    setCreateKeyForm((prev) => {
      const nextScopes = prev.scopes.includes(scope)
        ? prev.scopes.filter((value) => value !== scope)
        : [...prev.scopes, scope];
      return { ...prev, scopes: nextScopes };
    });
  };

  const closeCreateKeyModal = () => {
    setShowCreateKeyModal(false);
    setCreatedKey(null);
    setCreateKeyError(null);
  };

  const formatLastUsed = (value: string | null): string => {
    if (!value) return "Never";
    return new Date(value).toLocaleString();
  };

  const formatStatusClass = (status: ApiKeyRow["status"]): "pass" | "warn" | "fail" => {
    if (status === "ACTIVE") return "pass";
    if (status === "EXPIRED") return "warn";
    return "fail";
  };

  return (
    <Shell>
      <Header title="Organization" />
      {error ? <section className="panel error-panel">{error}</section> : null}

      {loading ? (
        <p>Loading organization...</p>
      ) : org ? (
        <>
          <section className="three-col">
            <article className="panel metric-card">
              <div className="metric-label">Plan</div>
              <div className="metric-value">{org.plan}</div>
            </article>
            <article className="panel metric-card">
              <div className="metric-label">Projects</div>
              <div className="metric-value">{org._count.projects}</div>
            </article>
            <article className="panel metric-card">
              <div className="metric-label">Members</div>
              <div className="metric-value">{org._count.users}</div>
            </article>
          </section>

          <section className="two-col">
            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>Organization details</h2>
                  <p>Update your organization name.</p>
                </div>
              </div>
              <form className="stack-form" onSubmit={(e) => void handleSaveName(e)}>
                <label>
                  Organization name
                  <input
                    value={nameEdit}
                    onChange={(e) => setNameEdit(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Slug (read-only)
                  <input value={org.slug} disabled />
                </label>
                <button type="submit" disabled={saving} data-action="api" data-endpoint="/org">{saving ? "Saving…" : "Save changes"}</button>
              </form>
            </section>

            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>Create status page</h2>
                  <p>Publish a public-facing status page for your clients.</p>
                </div>
              </div>
              <form className="stack-form" onSubmit={(e) => void handleCreateStatusPage(e)}>
                <label>
                  Title
                  <input
                    value={spForm.title}
                    onChange={(e) => setSpForm((f) => ({ ...f, title: e.target.value }))}
                    required
                    placeholder="Acme Status"
                  />
                </label>
                <label>
                  Slug
                  <input
                    value={spForm.slug}
                    onChange={(e) => {
                      const slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
                      setSpForm((f) => ({ ...f, slug }));
                    }}
                    required
                    placeholder="acme-status"
                  />
                </label>
                <label>
                  Description (optional)
                  <input
                    value={spForm.description}
                    onChange={(e) => setSpForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Current system status"
                  />
                </label>
                <label>
                  Linked project (optional)
                  <select
                    value={spForm.projectId}
                    onChange={(e) => setSpForm((f) => ({ ...f, projectId: e.target.value }))}
                  >
                    <option value="">All projects</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={spForm.isPublic}
                    onChange={(e) => setSpForm((f) => ({ ...f, isPublic: e.target.checked }))}
                  />
                  Public (visible without login)
                </label>
                <button type="submit" disabled={saving} data-action="api" data-endpoint="/org/status-pages">{saving ? "Creating…" : "Create status page"}</button>
              </form>
            </section>
          </section>

          {statusPages.length > 0 ? (
            <section className="panel">
              <div className="section-head">
                <div><h2>Status pages</h2></div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Slug</th>
                    <th>Project</th>
                    <th>Visibility</th>
                    <th>URL</th>
                  </tr>
                </thead>
                <tbody>
                  {statusPages.map((page) => (
                    <tr key={page.id}>
                      <td><strong>{page.title}</strong></td>
                      <td>{page.slug}</td>
                      <td>{page.project?.name || "All projects"}</td>
                      <td>
                        <span className={`result-pill ${page.isPublic ? "pass" : "warn"}`}>
                          {page.isPublic ? "Public" : "Private"}
                        </span>
                      </td>
                      <td>
                        <a href={`/status/${page.slug}`} target="_blank" rel="noreferrer">
                          /status/{page.slug}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          <section className="api-access-grid">
            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>API Keys &amp; Access</h2>
                  <p>Manage secure access for external systems and integrations.</p>
                </div>
                <button type="button" className="primary-button" onClick={() => setShowCreateKeyModal(true)} data-action="local-ui">+ Create API Key</button>
              </div>
              <div className="hint-panel">
                <strong>How to create an API key</strong>
                <ol>
                  <li>Click <strong>Create API Key</strong>.</li>
                  <li>Pick the project, usually <strong>Sparkle</strong>.</li>
                  <li>Keep <strong>events:write</strong> and <strong>heartbeats:write</strong> for ingestion.</li>
                  <li>Create it, then copy the key immediately. It is shown once.</li>
                </ol>
              </div>

              {apiKeys.length === 0 ? (
                <p>No API keys created yet.</p>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Prefix</th>
                        <th>Env</th>
                        <th>Scope</th>
                        <th>Project</th>
                        <th>Last used</th>
                        <th>Route</th>
                        <th>24h req</th>
                        <th>24h fail</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apiKeys.map((key) => (
                        <tr key={key.id}>
                          <td>{key.name}</td>
                          <td><code>{key.prefix}</code></td>
                          <td>
                            <span className={`result-pill ${key.environment === "live" ? "fail" : "warn"}`}>
                              {key.environment}
                            </span>
                          </td>
                          <td>{key.scopes.join(", ")}</td>
                          <td>{key.project?.name || "All projects"}</td>
                          <td title={key.lastUsedIp ?? undefined}>{formatLastUsed(key.lastUsedAt)}</td>
                          <td>
                            <code title={key.lastUsedUserAgent ?? undefined}>
                              {key.lastUsedRoute ?? "—"}
                            </code>
                          </td>
                          <td>{key.requests24h}</td>
                          <td>{key.failedAttempts24h > 0 ? <span className="result-pill fail">{key.failedAttempts24h}</span> : "0"}</td>
                          <td>
                            <span className={`result-pill ${formatStatusClass(key.status)}`}>{key.status}</span>
                            {key.revokeReason ? <span title={key.revokeReason}> &#9432;</span> : null}
                          </td>
                          <td>
                            {key.status === "ACTIVE" ? (
                              <button type="button" className="secondary-button" onClick={() => setRevokeTarget({ id: key.id, name: key.name })} data-action="local-ui">
                                Revoke
                              </button>
                            ) : (
                              <span>—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>API Usage</h2>
                  <p>Access activity over the last 24 hours.</p>
                </div>
              </div>
              <div className="stack-form">
                <label>
                  Last 24h requests
                  <input value={apiUsage ? String(apiUsage.last24hRequests) : "0"} disabled />
                </label>
                <label>
                  Failed auth attempts
                  <input value={apiUsage ? String(apiUsage.failedAuthAttempts) : "0"} disabled />
                </label>
                <label>
                  Active keys
                  <input value={apiUsage ? String(apiUsage.activeKeys) : "0"} disabled />
                </label>
              </div>
            </section>
          </section>
        </>
      ) : null}

      {revokeTarget ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Revoke API key">
          <section className="modal-panel" style={{ maxWidth: "440px" }}>
            <div className="section-head">
              <div>
                <h2>Revoke key</h2>
                <p>Revoke <strong>{revokeTarget.name}</strong>? This cannot be undone.</p>
              </div>
              <button type="button" className="secondary-button" onClick={() => { setRevokeTarget(null); setRevokeReason(""); }} data-action="local-ui">Cancel</button>
            </div>
            <div className="stack-form">
              <label>
                Reason (optional)
                <input
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  placeholder="e.g. Compromised, no longer needed"
                  maxLength={255}
                />
              </label>
              <button type="button" onClick={() => void handleRevokeApiKey(revokeTarget.id, revokeReason)} data-action="api" data-endpoint="/org/api-keys/:id/revoke">
                Confirm revoke
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {showCreateKeyModal ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Create API key">
          <section className="modal-panel">
            <div className="section-head">
              <div>
                <h2>Create API Key</h2>
                <p>Generate a new key for ingestion and integrations.</p>
              </div>
              <button type="button" className="secondary-button" onClick={closeCreateKeyModal} data-action="local-ui">Close</button>
            </div>

            {createdKey ? (
              <div className="stack-form">
                <label>
                  Your API key
                  <input value={createdKey.key} readOnly />
                </label>
                <button
                  type="button"
                  className="primary-button"
                  data-action="local-ui"
                  onClick={() => void navigator.clipboard.writeText(createdKey.key)}
                >
                  Copy
                </button>
                <p className="warn-text">This key is shown only once. Store it securely now.</p>
              </div>
            ) : (
              <form className="stack-form" onSubmit={(e) => void handleCreateApiKey(e)}>
                <label>
                  Name
                  <input
                    value={createKeyForm.name}
                    onChange={(e) => setCreateKeyForm((prev) => ({ ...prev, name: e.target.value }))}
                    required
                  />
                </label>

                <label>
                  Environment
                  <select
                    value={createKeyForm.environment}
                    onChange={(e) =>
                      setCreateKeyForm((prev) => ({ ...prev, environment: e.target.value as "live" | "test" }))
                    }
                  >
                    <option value="live">Live</option>
                    <option value="test">Test</option>
                  </select>
                </label>

                <fieldset className="scope-grid">
                  <legend>Scopes</legend>
                  {KEY_SCOPES.map((scope) => (
                    <label key={scope} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={createKeyForm.scopes.includes(scope)}
                        onChange={() => toggleScope(scope)}
                      />
                      {scope}
                    </label>
                  ))}
                </fieldset>

                <label>
                  Project (optional)
                  <select
                    value={createKeyForm.projectId}
                    onChange={(e) => setCreateKeyForm((prev) => ({ ...prev, projectId: e.target.value }))}
                  >
                    <option value="">All projects</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </select>
                </label>

                <label>
                  Expiry (optional)
                  <input
                    type="datetime-local"
                    value={createKeyForm.expiresAt}
                    onChange={(e) => setCreateKeyForm((prev) => ({ ...prev, expiresAt: e.target.value }))}
                  />
                </label>

                {createKeyError ? <div className="error-chip">{createKeyError}</div> : null}

                <button className="primary-button" type="submit" disabled={creatingKey || createKeyForm.scopes.length === 0} data-action="api" data-endpoint="/org/api-keys">
                  {creatingKey ? "Creating..." : "Create key"}
                </button>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </Shell>
  );
}
