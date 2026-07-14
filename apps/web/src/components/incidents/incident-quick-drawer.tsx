"use client";

import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../lib/api";
import { StatusBadge, severityTone } from "../ui/status-badge";

type IncidentPreview = {
  id: string;
  title: string;
  severity: string;
  status: string;
  openedAt: string;
  rootCause?: string | null;
  owner?: string | null;
  alertCount?: number;
  affectedServices?: Array<{ id: string; name: string }>;
  correlatedDeployCount?: number;
  project?: { id: string; name: string; owner?: string | null };
};

export function IncidentQuickDrawer({
  incident,
  onClose,
  onStatusChanged
}: {
  incident: IncidentPreview | null;
  onClose: () => void;
  onStatusChanged?: (id: string, status: string) => void;
}) {
  const [acting, setActing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!incident) return null;

  const owner = incident.owner || incident.project?.owner || null;

  const patchStatus = async (status: string, confirmReopen = false) => {
    if (confirmReopen && !window.confirm("Reopen this incident?")) return;
    setActing(true);
    setMessage(null);
    try {
      await apiFetch(`/incidents/${incident.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      onStatusChanged?.(incident.id, status);
      setMessage(`Status → ${status}`);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Status update failed");
    } finally {
      setActing(false);
    }
  };

  return (
    <aside className="incident-quick-drawer panel" role="dialog" aria-label="Incident preview">
      <div className="section-head">
        <div>
          <h2>{incident.title}</h2>
          <p className="dashboard-subtle">Quick preview — open the full workspace for timeline and diagnosis.</p>
        </div>
        <button type="button" className="secondary-button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="snapshot-grid">
        <div className="snapshot-item">
          <span className="snapshot-label">Severity</span>
          <strong>
            <StatusBadge label={incident.severity} tone={severityTone(incident.severity)} />
          </strong>
        </div>
        <div className="snapshot-item">
          <span className="snapshot-label">Status</span>
          <strong>{incident.status}</strong>
        </div>
        <div className="snapshot-item">
          <span className="snapshot-label">Owner</span>
          <strong>{owner || "Unassigned"}</strong>
        </div>
        <div className="snapshot-item">
          <span className="snapshot-label">Opened</span>
          <strong>{new Date(incident.openedAt).toLocaleString()}</strong>
        </div>
        <div className="snapshot-item">
          <span className="snapshot-label">Linked alerts</span>
          <strong>{incident.alertCount ?? 0}</strong>
        </div>
        <div className="snapshot-item">
          <span className="snapshot-label">Deploy correlation</span>
          <strong>
            {incident.correlatedDeployCount && incident.correlatedDeployCount > 0
              ? `${incident.correlatedDeployCount} change event(s)`
              : "None recorded"}
          </strong>
        </div>
      </div>

      <section className="topology-detail-section">
        <h3>Affected scope</h3>
        {(incident.affectedServices ?? []).length === 0 ? (
          <p className="dashboard-subtle">No linked services on this incident yet.</p>
        ) : (
          <ul className="intelligence-muted-list">
            {(incident.affectedServices ?? []).map((service) => (
              <li key={service.id}>{service.name}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="topology-detail-section">
        <h3>Root cause</h3>
        <p>{incident.rootCause || "Not recorded — will appear only when known."}</p>
      </section>

      <section className="topology-detail-section">
        <h3>Actions</h3>
        <div className="incident-status-actions" role="group" aria-label="Incident status actions">
          {incident.status === "OPEN" ? (
            <button
              type="button"
              className="primary-button"
              disabled={acting}
              onClick={() => void patchStatus("INVESTIGATING")}
              title="Supported by PATCH /incidents/:id — sets Investigating and acknowledgedAt"
            >
              Acknowledge / investigate
            </button>
          ) : null}
          {incident.status !== "RESOLVED" && incident.status !== "OPEN" ? (
            <button
              type="button"
              className="primary-button"
              disabled={acting}
              onClick={() => void patchStatus("RESOLVED")}
            >
              Resolve
            </button>
          ) : null}
          {incident.status === "RESOLVED" ? (
            <button
              type="button"
              className="secondary-button"
              disabled={acting}
              onClick={() => void patchStatus("OPEN", true)}
            >
              Reopen
            </button>
          ) : null}
        </div>
        {message ? <p className="metric-label">{message}</p> : null}
      </section>

      <div className="portfolio-links">
        {incident.project?.id ? (
          <>
            <Link href={`/projects/${incident.project.id}/topology`}>Topology</Link>
            <Link href={`/projects/${incident.project.id}/alerts`}>Alerts</Link>
            <Link href={`/projects/${incident.project.id}/automation`}>Automation</Link>
            <Link href={`/projects/${incident.project.id}/insights`}>Intelligence</Link>
          </>
        ) : null}
        <Link href={`/alerts?q=${encodeURIComponent(incident.title)}`}>Related alerts</Link>
      </div>

      <p>
        <Link className="primary-button" href={`/incidents/${incident.id}`}>
          Open full incident workspace
        </Link>
      </p>
    </aside>
  );
}
