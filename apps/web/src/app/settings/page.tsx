"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { PageSection } from "../../components/ui/page-section";
import { apiFetch } from "../../lib/api";

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

export default function SettingsPage() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
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

  return (
    <Shell>
      <Header title="Settings" />
      <p className="dashboard-subtle">
        Platform notification preferences. Provider connections live in <Link href="/integrations">Integrations</Link>.
      </p>
      {error ? <section className="panel error-panel">{error}</section> : null}

      <section className="two-col settings-grid">
        <PageSection
          title="Add notification channel"
          description="Create an email destination or webhook target for alerts."
          persistKey="org:settings:notifications:add"
        >
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
        </PageSection>

        <PageSection
          title="Configured channels"
          description={loading ? "Loading current alert destinations..." : `${channels.length} configured`}
          persistKey="org:settings:notifications:list"
        >
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
        </PageSection>
      </section>
    </Shell>
  );
}
