"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Shell } from "../../../components/layout/shell";
import { Header } from "../../../components/layout/header";
import { apiFetch } from "../../../lib/api";

type AlertDetail = {
  id: string;
  message: string;
  category: string;
  sourceType: string;
  project: { id: string; name: string };
  service: { id: string; name: string } | null;
  assignedTo: { id: string; name: string; email: string } | null;
  incidents: Array<{ id: string; title: string; severity: string; status: string; openedAt: string }>;
  title: string;
  severity: string;
  status: string;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
};

export default function AlertDetailPage() {
  const params = useParams<{ alertId: string }>();
  const alertId = params?.alertId ?? "";

  const [alert, setAlert] = useState<AlertDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!alertId) return;
    setLoading(true);
    setError(null);
    try {
      const row = await apiFetch<AlertDetail>(`/alerts/${alertId}`);
      setAlert(row);
    } catch (err: any) {
      setError(err?.message || "Failed to load alert");
      setAlert(null);
    } finally {
      setLoading(false);
    }
  }, [alertId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runStatusAction = async (action: "acknowledge" | "resolve") => {
    if (!alert) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<AlertDetail>(`/alerts/${alert.id}/${action}`, {
        method: "PATCH"
      });
      setAlert(updated);
    } catch (err: any) {
      setError(err?.message || `Failed to ${action} alert`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell>
      <Header title={alert ? alert.title : "Alert"} />
      {error ? <section className="panel error-panel">{error}</section> : null}

      {loading ? (
        <section className="panel">Loading alert...</section>
      ) : !alert ? (
        <section className="panel">Alert not found.</section>
      ) : (
        <>
          <section className="three-col">
            <article className="panel metric-card">
              <div className="metric-label">Severity</div>
              <div className="metric-value">{alert.severity}</div>
            </article>
            <article className="panel metric-card">
              <div className="metric-label">Status</div>
              <div className="metric-value">{alert.status}</div>
            </article>
            <article className="panel metric-card">
              <div className="metric-label">First seen</div>
              <div className="metric-value">{new Date(alert.firstSeenAt).toLocaleString()}</div>
            </article>
          </section>

          <section className="panel">
            <div className="section-head">
              <div>
                <h2>Alert details</h2>
                <p>Review timestamps, metadata, and update alert status.</p>
              </div>
            </div>
            <p>
              <strong>Last seen:</strong> {new Date(alert.lastSeenAt).toLocaleString()}
            </p>
            <p>
              <strong>Project:</strong> <Link href={`/projects/${alert.project.id}`}>{alert.project.name}</Link>
            </p>
            <p>
              <strong>Service:</strong> {alert.service ? <Link href={`/checks?serviceId=${alert.service.id}`}>{alert.service.name}</Link> : "-"}
            </p>
            <p>
              <strong>Source:</strong> {alert.sourceType} · {alert.category}
            </p>
            <p>
              <strong>Message:</strong> {alert.message}
            </p>
            <p>
              <strong>Acknowledged:</strong> {alert.acknowledgedAt ? new Date(alert.acknowledgedAt).toLocaleString() : "-"}
            </p>
            <p>
              <strong>Resolved:</strong> {alert.resolvedAt ? new Date(alert.resolvedAt).toLocaleString() : "-"}
            </p>
            <p>
              <strong>Assigned to:</strong> {alert.assignedTo ? `${alert.assignedTo.name} (${alert.assignedTo.email})` : "-"}
            </p>

            <h3>Linked incidents</h3>
            {alert.incidents.length === 0 ? (
              <p className="table-subtle">No incidents are currently linked to this alert.</p>
            ) : (
              <ul className="dashboard-list">
                {alert.incidents.map((incident) => (
                  <li key={incident.id}>
                    <Link href={`/incidents/${incident.id}`}>{incident.title}</Link>
                    <div className="dashboard-subtle">{incident.status} · {incident.severity} · Opened {new Date(incident.openedAt).toLocaleString()}</div>
                  </li>
                ))}
              </ul>
            )}

            <div className="channel-actions">
              <button
                type="button"
                className="secondary-button"
                data-action="api"
                data-endpoint="/alerts/:alertId/acknowledge"
                onClick={() => void runStatusAction("acknowledge")}
                disabled={saving || alert.status !== "OPEN"}
              >
                {saving ? "Saving..." : "Acknowledge"}
              </button>
              <button
                type="button"
                className="secondary-button"
                data-action="api"
                data-endpoint="/alerts/:alertId/resolve"
                onClick={() => void runStatusAction("resolve")}
                disabled={saving || alert.status === "RESOLVED"}
              >
                {saving ? "Saving..." : "Resolve"}
              </button>
            </div>
          </section>
        </>
      )}

      <p className="incident-back-link">
        <Link href="/alerts" className="onboarding-link primary-button">
          ← Back to alerts
        </Link>
      </p>
    </Shell>
  );
}
