"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { apiFetch } from "../../lib/api";

type IntegrationType =
  | "WEBHOOK"
  | "EMAIL"
  | "STRIPE"
  | "WORKER_PROVIDER"
  | "SERVICE_PROVIDER"
  | "DEPLOYMENT_PROVIDER"
  | "STATUS_PROVIDER"
  | "RUNBOOK_PROVIDER";

type IntegrationValidationStatus = "UNKNOWN" | "VALID" | "INVALID";

type ProjectIntegration = {
  id: string;
  projectId: string;
  type: IntegrationType;
  name: string | null;
  enabled: boolean;
  configJson: Record<string, unknown> | null;
  secretRef: string | null;
  validationStatus: IntegrationValidationStatus;
  validationMessage: string | null;
  lastValidatedAt: string | null;
  project?: ProjectOption | null;
};

type ProjectOption = {
  id: string;
  name: string;
  slug: string;
};

type NotificationChannel = {
  id: string;
  projectId: string | null;
  type: "EMAIL" | "WEBHOOK";
  name: string;
  target: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  project?: ProjectOption | null;
};

const INTEGRATION_CONFIG_PRESETS: Record<IntegrationType, Record<string, unknown>> = {
  WEBHOOK: {
    WEBHOOK_URL: "",
    WEBHOOK_TIMEOUT_MS: 5000,
    WEBHOOK_SIGNING_HEADER: "X-OpsWatch-Signature"
  },
  EMAIL: {
    EMAIL_PROVIDER_HEALTHCHECK_URL: "",
    EMAIL_FROM: "alerts@example.com",
    EMAIL_REPLY_TO: ""
  },
  STRIPE: {
    STRIPE_API_KEY: "",
    STRIPE_API_BASE: "https://api.stripe.com",
    STRIPE_WEBHOOK_SECRET: ""
  },
  WORKER_PROVIDER: {
    WORKER_RESTART_WEBHOOK_URL: "",
    WORKER_PROVIDER_TIMEOUT_MS: 5000
  },
  SERVICE_PROVIDER: {
    SERVICE_RESTART_WEBHOOK_URL: "",
    SERVICE_PROVIDER_TIMEOUT_MS: 5000
  },
  DEPLOYMENT_PROVIDER: {
    DEPLOYMENT_ROLLBACK_WEBHOOK_URL: "",
    DEPLOYMENT_PROVIDER_TIMEOUT_MS: 5000
  },
  STATUS_PROVIDER: {
    PROVIDER_STATUS_URL: "",
    STATUS_PAGE_COMPONENT: "",
    STATUS_PAGE_ENV: ""
  },
  RUNBOOK_PROVIDER: {
    RUNBOOK_BASE_URL: "",
    RUNBOOK_DEFAULT_OWNER: "platform",
    RUNBOOK_TEMPLATE: "incident-standard"
  }
};

const integrationStatusLabel = (row?: ProjectIntegration): string => {
  if (!row) return "Untested";
  if (!row.enabled) return "Disabled";
  if (row.validationStatus === "VALID") return "Connected";
  if (row.validationStatus === "INVALID") {
    const message = (row.validationMessage || "").toLowerCase();
    if (message.includes("missing") || message.includes("config") || message.includes("credential")) {
      return "Missing credentials";
    }
    return "Validation failed";
  }
  return "Untested";
};

export default function SettingsPage() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [integrations, setIntegrations] = useState<ProjectIntegration[]>([]);
  const [integrationSavingKey, setIntegrationSavingKey] = useState<string | null>(null);
  const [integrationValidatingKey, setIntegrationValidatingKey] = useState<string | null>(null);
  const [integrationDraft, setIntegrationDraft] = useState<Record<string, {
    enabled: boolean;
    name: string;
    secretRef: string;
    configJsonText: string;
  }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "EMAIL",
    target: "",
    projectId: "",
    isDefault: false
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectRows, channelRows] = await Promise.all([
        apiFetch<ProjectOption[]>("/projects"),
        apiFetch<NotificationChannel[]>("/settings/notifications")
      ]);
      setProjects(projectRows.map((row) => ({ id: row.id, name: row.name, slug: row.slug })));
      setChannels(channelRows);

      const integrationRows = await apiFetch<ProjectIntegration[]>("/settings/integrations");
      setIntegrations(integrationRows);

      const initialDrafts: Record<string, {
        enabled: boolean;
        name: string;
        secretRef: string;
        configJsonText: string;
      }> = {};
      integrationRows.forEach((row) => {
        const key = `${row.projectId}:${row.type}`;
        initialDrafts[key] = {
          enabled: row.enabled,
          name: row.name ?? "",
          secretRef: row.secretRef ?? "",
          configJsonText: JSON.stringify(row.configJson ?? {}, null, 2)
        };
      });
      setIntegrationDraft(initialDrafts);
    } catch (loadError: any) {
      setError(loadError?.message || "Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const created = await apiFetch<NotificationChannel>("/settings/notifications", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          target: form.target,
          projectId: form.projectId || null,
          isDefault: form.isDefault
        })
      });

      setChannels((current) => [created, ...current]);
      setForm({ name: "", type: "EMAIL", target: "", projectId: "", isDefault: false });
    } catch (submitError: any) {
      setError(submitError?.message || "Failed to create notification channel");
    } finally {
      setSaving(false);
    }
  };

  const toggleChannel = async (channel: NotificationChannel) => {
    try {
      const updated = await apiFetch<NotificationChannel>(`/settings/notifications/${channel.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !channel.isActive })
      });

      setChannels((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    } catch (toggleError: any) {
      setError(toggleError?.message || "Failed to update notification channel");
    }
  };

  const deleteChannel = async (channelId: string) => {
    try {
      await apiFetch(`/settings/notifications/${channelId}`, { method: "DELETE" });
      setChannels((current) => current.filter((row) => row.id !== channelId));
    } catch (deleteError: any) {
      setError(deleteError?.message || "Failed to delete notification channel");
    }
  };

  const integrationTypes: IntegrationType[] = [
    "WEBHOOK",
    "EMAIL",
    "STRIPE",
    "WORKER_PROVIDER",
    "SERVICE_PROVIDER",
    "DEPLOYMENT_PROVIDER",
    "STATUS_PROVIDER",
    "RUNBOOK_PROVIDER"
  ];

  const getIntegrationFor = (projectId: string, type: IntegrationType): ProjectIntegration | undefined =>
    integrations.find((row) => row.projectId === projectId && row.type === type);

  const getDraftFor = (projectId: string, type: IntegrationType) => {
    const key = `${projectId}:${type}`;
    const existing = integrationDraft[key];
    if (existing) return existing;
    return {
      enabled: true,
      name: "",
      secretRef: "",
      configJsonText: "{}"
    };
  };

  const setDraftFor = (
    projectId: string,
    type: IntegrationType,
    update: Partial<{ enabled: boolean; name: string; secretRef: string; configJsonText: string }>
  ) => {
    const key = `${projectId}:${type}`;
    setIntegrationDraft((current) => ({
      ...current,
      [key]: {
        ...getDraftFor(projectId, type),
        ...current[key],
        ...update
      }
    }));
  };

  const applyConfigPreset = (projectId: string, type: IntegrationType) => {
    const preset = INTEGRATION_CONFIG_PRESETS[type] ?? {};
    const current = getDraftFor(projectId, type);

    let parsedCurrent: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(current.configJsonText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        parsedCurrent = parsed as Record<string, unknown>;
      }
    } catch {
      parsedCurrent = {};
    }

    const merged = {
      ...preset,
      ...parsedCurrent
    };

    setDraftFor(projectId, type, {
      configJsonText: JSON.stringify(merged, null, 2)
    });
  };

  const saveIntegration = async (projectId: string, type: IntegrationType) => {
    const key = `${projectId}:${type}`;
    setIntegrationSavingKey(key);
    setError(null);
    try {
      const draft = getDraftFor(projectId, type);
      const configJson = JSON.parse(draft.configJsonText) as Record<string, unknown>;

      const updated = await apiFetch<ProjectIntegration>(`/settings/integrations/${projectId}/${type}`, {
        method: "PUT",
        body: JSON.stringify({
          enabled: draft.enabled,
          name: draft.name || undefined,
          secretRef: draft.secretRef || undefined,
          configJson
        })
      });

      setIntegrations((current) => {
        const index = current.findIndex((row) => row.projectId === projectId && row.type === type);
        if (index === -1) {
          return [...current, updated];
        }
        const next = [...current];
        next[index] = updated;
        return next;
      });
    } catch (saveError: any) {
      setError(saveError?.message || "Failed to save integration");
    } finally {
      setIntegrationSavingKey(null);
    }
  };

  const validateIntegration = async (projectId: string, type: IntegrationType) => {
    const key = `${projectId}:${type}`;
    setIntegrationValidatingKey(key);
    setError(null);
    try {
      const updated = await apiFetch<ProjectIntegration>(`/settings/integrations/${projectId}/${type}/validate`, {
        method: "POST"
      });
      setIntegrations((current) =>
        current.map((row) =>
          row.projectId === projectId && row.type === type ? updated : row
        )
      );
    } catch (validateError: any) {
      setError(validateError?.message || "Failed to validate integration");
    } finally {
      setIntegrationValidatingKey(null);
    }
  };

  return (
    <Shell>
      <Header title="Settings" />
      {error ? <section className="panel error-panel">{error}</section> : null}

      <section className="two-col settings-grid">
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Add notification channel</h2>
              <p>Create an email destination or webhook target for alerts.</p>
            </div>
          </div>
          <form className="stack-form" onSubmit={handleSubmit}>
            <label>
              Name
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Primary on-call email"
                required
              />
            </label>

            <label>
              Type
              <select
                value={form.type}
                onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as "EMAIL" | "WEBHOOK" }))}
              >
                <option value="EMAIL">Email</option>
                <option value="WEBHOOK">Webhook</option>
              </select>
            </label>

            <label>
              {form.type === "EMAIL" ? "Recipient email" : "Webhook URL"}
              <input
                value={form.target}
                onChange={(event) => setForm((current) => ({ ...current, target: event.target.value }))}
                placeholder={form.type === "EMAIL" ? "alerts@example.com" : "https://hooks.slack.com/..."}
                required
              />
            </label>

            <label>
              Scope
              <select
                value={form.projectId}
                onChange={(event) => setForm((current) => ({ ...current, projectId: event.target.value }))}
              >
                <option value="">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(event) => setForm((current) => ({ ...current, isDefault: event.target.checked }))}
              />
              Use as default channel for alerts across projects
            </label>

            <button type="submit" disabled={saving} data-action="api" data-endpoint="/settings/notifications">
              {saving ? "Saving..." : "Add channel"}
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Configured channels</h2>
              <p>{loading ? "Loading current alert destinations..." : `${channels.length} configured`}</p>
            </div>
          </div>

          {loading ? (
            <p>Loading channels...</p>
          ) : channels.length === 0 ? (
            <p>No notification channels configured yet.</p>
          ) : (
            <div className="channel-list">
              {channels.map((channel) => (
                <article key={channel.id} className="channel-card">
                  <div className="channel-head">
                    <div>
                      <strong><Link href={`/settings/notifications/${channel.id}`}>{channel.name}</Link></strong>
                      <div className="table-subtle">
                        {channel.type} • {channel.project?.name || (channel.isDefault ? "Default" : "All projects")}
                      </div>
                    </div>
                    <span className={`result-pill ${channel.isActive ? "pass" : "warn"}`}>
                      {channel.isActive ? "ACTIVE" : "PAUSED"}
                    </span>
                  </div>
                  <div className="channel-target">{channel.target}</div>
                  <div className="channel-actions">
                    <button type="button" className="secondary-button" onClick={() => void toggleChannel(channel)} data-action="api" data-endpoint="/settings/notifications/:id">
                      {channel.isActive ? "Disable" : "Enable"}
                    </button>
                    <button type="button" className="secondary-button danger-button" onClick={() => void deleteChannel(channel.id)} data-action="api" data-endpoint="/settings/notifications/:id">
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Project integrations</h2>
            <p>Configure provider credentials per project and validate connectivity.</p>
          </div>
        </div>

        {projects.length === 0 ? (
          <p>No projects available.</p>
        ) : (
          <div className="integration-grid">
            {projects.map((project) => (
              <article key={project.id} className="channel-card">
                <div className="channel-head">
                  <strong>{project.name}</strong>
                  <span className="table-subtle">{project.slug}</span>
                </div>
                <div className="integration-rows">
                  {integrationTypes.map((type) => {
                    const key = `${project.id}:${type}`;
                    const row = getIntegrationFor(project.id, type);
                    const draft = getDraftFor(project.id, type);
                    return (
                      <details
                        key={key}
                        className="integration-row"
                        onToggle={(event) => {
                          if ((event.currentTarget as HTMLDetailsElement).open) {
                            // Seed keys when a type is opened so operators can fill values quickly.
                            applyConfigPreset(project.id, type);
                          }
                        }}
                      >
                        <summary>
                          <span>{type}</span>
                            <span className={`result-pill ${row?.validationStatus === "VALID" ? "pass" : row?.validationStatus === "INVALID" ? "fail" : "unknown"}`}>
                              {integrationStatusLabel(row)}
                          </span>
                        </summary>
                        <div className="integration-form">
                            <div>
                              <Link className="table-subtle" href={`/projects/${project.id}/integrations/${type.toLowerCase()}`}>
                                Open provider detail →
                              </Link>
                            </div>
                          <label className="checkbox-row">
                            <input
                              type="checkbox"
                              checked={draft.enabled}
                              onChange={(event) => setDraftFor(project.id, type, { enabled: event.target.checked })}
                            />
                            Enabled
                          </label>
                          <label>
                            Display name
                            <input
                              value={draft.name}
                              onChange={(event) => setDraftFor(project.id, type, { name: event.target.value })}
                              placeholder={`${type.toLowerCase()} integration`}
                            />
                          </label>
                          <label>
                            Secret reference
                            <input
                              value={draft.secretRef}
                              onChange={(event) => setDraftFor(project.id, type, { secretRef: event.target.value })}
                              placeholder="vault://opswatch/..."
                            />
                          </label>
                          <label>
                            <div className="integration-config-head">
                              <span>Config JSON</span>
                              <button
                                type="button"
                                className="secondary-button integration-preset-button"
                                data-action="local-ui"
                                onClick={() => applyConfigPreset(project.id, type)}
                              >
                                Apply preset
                              </button>
                            </div>
                            <textarea
                              value={draft.configJsonText}
                              onChange={(event) => setDraftFor(project.id, type, { configJsonText: event.target.value })}
                              rows={5}
                            />
                            <span className="table-subtle integration-preset-hint">
                              Recommended keys: {Object.keys(INTEGRATION_CONFIG_PRESETS[type]).join(", ")}
                            </span>
                          </label>
                          {row?.validationMessage ? (
                            <p className="table-subtle">{row.validationMessage}</p>
                          ) : null}
                          <div className="channel-actions">
                            <button
                              type="button"
                              className="secondary-button"
                              data-action="api"
                              data-endpoint="/settings/integrations/:projectId/:type"
                              onClick={() => void saveIntegration(project.id, type)}
                              disabled={integrationSavingKey === key}
                            >
                              {integrationSavingKey === key ? "Saving..." : "Save"}
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              data-action="api"
                              data-endpoint="/settings/integrations/:projectId/:type/validate"
                              onClick={() => void validateIntegration(project.id, type)}
                              disabled={integrationValidatingKey === key || !row}
                            >
                              {integrationValidatingKey === key ? "Validating..." : "Validate"}
                            </button>
                          </div>
                        </div>
                      </details>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}
