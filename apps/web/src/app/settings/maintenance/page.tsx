"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "../../../components/layout/shell";
import { Header } from "../../../components/layout/header";
import { PageSection } from "../../../components/ui/page-section";
import { apiFetch } from "../../../lib/api";

type MaintenanceWindow = {
  id: string;
  name: string;
  description: string | null;
  projectId: string | null;
  startsAt: string;
  endsAt: string;
  status: "SCHEDULED" | "ACTIVE" | "COMPLETED" | "CANCELLED";
  suppressAlerts: boolean;
  suppressIncidents: boolean;
  allowAutonomous: boolean;
  serviceIds: string[];
};

type ProjectOption = { id: string; name: string };

const emptyForm = {
  name: "",
  description: "",
  projectId: "",
  startsAt: "",
  endsAt: "",
  suppressAlerts: true,
  suppressIncidents: false,
  allowAutonomous: false,
  serviceIdsText: ""
};

export default function MaintenanceWindowsPage() {
  const [rows, setRows] = useState<MaintenanceWindow[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [windows, projectRows] = await Promise.all([
        apiFetch<MaintenanceWindow[]>("/maintenance-windows"),
        apiFetch<ProjectOption[]>("/projects")
      ]);
      setRows(windows);
      setProjects(projectRows);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load maintenance windows");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/maintenance-windows", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          projectId: form.projectId || null,
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
          suppressAlerts: form.suppressAlerts,
          suppressIncidents: form.suppressIncidents,
          allowAutonomous: form.allowAutonomous,
          serviceIds: form.serviceIdsText
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
        })
      });
      setForm(emptyForm);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Failed to create maintenance window");
    } finally {
      setSaving(false);
    }
  };

  const cancelWindow = async (id: string) => {
    try {
      await apiFetch(`/maintenance-windows/${id}/cancel`, { method: "POST", body: "{}" });
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Failed to cancel window");
    }
  };

  return (
    <Shell>
      <Header title="Maintenance Windows" />
      <section className="panel">
        <nav className="pill-row">
          <Link className="pill" href="/settings">
            Settings
          </Link>
          <span className="pill">Maintenance Windows</span>
        </nav>
        <p className="dashboard-subtle">
          Schedule maintenance to suppress alerts and optionally block incident correlation and autonomous automation.
          Suppressed signals are stored with metadata — nothing is silently discarded.
        </p>
      </section>

      {error ? <section className="panel error-panel">{error}</section> : null}

      <PageSection
        title="Schedule window"
        description="Create a maintenance window with alert and automation policy controls."
        persistKey="org:settings:maintenance:schedule"
      >
        <form className="form-grid" onSubmit={(event) => void onSubmit(event)}>
          <label>
            Name
            <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>
            Project (optional)
            <select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}>
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Starts at
            <input
              type="datetime-local"
              required
              value={form.startsAt}
              onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
            />
          </label>
          <label>
            Ends at
            <input
              type="datetime-local"
              required
              value={form.endsAt}
              onChange={(event) => setForm({ ...form, endsAt: event.target.value })}
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.suppressAlerts}
              onChange={(event) => setForm({ ...form, suppressAlerts: event.target.checked })}
            />
            Suppress alerts (store as maintenance-suppressed)
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.suppressIncidents}
              onChange={(event) => setForm({ ...form, suppressIncidents: event.target.checked })}
            />
            Suppress incident correlation
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.allowAutonomous}
              onChange={(event) => setForm({ ...form, allowAutonomous: event.target.checked })}
            />
            Allow autonomous automation during window
          </label>
          <label>
            Service IDs (comma-separated, empty = all services in scope)
            <input
              value={form.serviceIdsText}
              onChange={(event) => setForm({ ...form, serviceIdsText: event.target.value })}
            />
          </label>
          <label>
            Description
            <textarea
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </label>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "Creating…" : "Create window"}
          </button>
        </form>
      </PageSection>

      <PageSection
        title="Windows"
        description="Scheduled, active, and historical maintenance windows."
        persistKey="org:settings:maintenance:windows"
      >
        {loading ? (
          <p>Loading…</p>
        ) : rows.length === 0 ? (
          <p className="dashboard-subtle">No maintenance windows scheduled.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Schedule</th>
                  <th>Policy</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                      {row.description ? <div className="table-subtle">{row.description}</div> : null}
                    </td>
                    <td>
                      <span className={`status-pill status-${row.status.toLowerCase()}`}>{row.status}</span>
                    </td>
                    <td>
                      {new Date(row.startsAt).toLocaleString()} → {new Date(row.endsAt).toLocaleString()}
                    </td>
                    <td className="table-subtle">
                      {row.suppressAlerts ? "Suppress alerts" : "Alerts active"}
                      {row.suppressIncidents ? " · No incidents" : ""}
                      {row.allowAutonomous ? " · Autonomous allowed" : ""}
                    </td>
                    <td>
                      {row.status === "SCHEDULED" || row.status === "ACTIVE" ? (
                        <button type="button" className="btn ghost" onClick={() => void cancelWindow(row.id)}>
                          Cancel
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageSection>
    </Shell>
  );
}
