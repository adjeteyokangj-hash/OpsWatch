"use client";

import Link from "next/link";
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
  onClose
}: {
  incident: IncidentPreview | null;
  onClose: () => void;
}) {
  if (!incident) return null;

  const owner = incident.owner || incident.project?.owner || null;

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

      <p>
        <Link className="primary-button" href={`/incidents/${incident.id}`}>
          Open full incident workspace
        </Link>
      </p>
    </aside>
  );
}
