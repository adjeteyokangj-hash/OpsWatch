"use client";

import Link from "next/link";
import { formatRelativeTime } from "../../lib/relative-time";
import { healthLabel, healthTone } from "../../lib/health-tones";
import { StatusBadge } from "../ui/status-badge";

const lastSeenAt = (row: any): string | null => {
  const heartbeat = row.heartbeats?.[0]?.receivedAt;
  if (heartbeat) return heartbeat;
  if (row.lastSignalAt) return row.lastSignalAt;
  if (row.lastCompletedCheckAt) return row.lastCompletedCheckAt;
  return null;
};

const unresolvedIncidents = (row: any): number =>
  (row.incidents || []).filter((incident: any) => incident.status !== "RESOLVED").length;

const openAlerts = (row: any): number =>
  (row.alerts || []).filter((alert: any) => alert.status === "OPEN" || alert.status === "ACKNOWLEDGED").length;

const ownershipLabel = (row: any): string => row.projectOwner || row.clientName || "Unassigned";

const evidenceRisk = (row: any): { label: string; tone: "danger" | "warning" | "success" | "muted" } => {
  const alerts = openAlerts(row);
  const incidents = unresolvedIncidents(row);
  if (row.status === "DOWN" || incidents > 0) {
    return { label: `${incidents} incident(s) · ${alerts} alert(s)`, tone: "danger" };
  }
  if (row.status === "DEGRADED" || alerts > 0) {
    return { label: `${alerts} open alert(s)`, tone: "warning" };
  }
  if (row.status === "UNKNOWN") {
    return { label: "Insufficient evidence", tone: "muted" };
  }
  return { label: "No open risk signals", tone: "success" };
};

export function ApplicationsPortfolioCards({ rows }: { rows: Array<any> }) {
  return (
    <div className="applications-portfolio-grid" role="list">
      {rows.map((row) => {
        const seen = lastSeenAt(row);
        const risk = evidenceRisk(row);
        const label = healthLabel(row.status, row.healthDisplayLabel);
        const tone = healthTone(row.status);
        const waiting =
          row.status === "UNKNOWN" && !seen
            ? "Waiting for first heartbeat or completed check"
            : null;

        return (
          <article key={row.id} className="application-portfolio-card panel" role="listitem">
            <div className="application-portfolio-card-head">
              <div>
                <h2>
                  <Link href={`/projects/${row.id}`}>{row.name}</Link>
                </h2>
                <p className="dashboard-subtle">
                  {ownershipLabel(row)} · {row.environment || "—"}
                </p>
              </div>
              <span className={`result-pill pill ${tone}`}>{label}</span>
            </div>

            {waiting ? <p className="application-portfolio-unknown" role="status">{waiting}</p> : null}
            {row.healthReason && row.status !== "HEALTHY" ? (
              <p className="dashboard-subtle">{row.healthReason}</p>
            ) : null}

            <div className="application-portfolio-meta">
              <div>
                <span className="snapshot-label">Last seen</span>
                <strong>{formatRelativeTime(seen)}</strong>
              </div>
              <div>
                <span className="snapshot-label">Risk (evidence)</span>
                <StatusBadge label={risk.label} tone={risk.tone} />
              </div>
              <div>
                <span className="snapshot-label">Alerts</span>
                <strong>
                  <Link href={`/projects/${row.id}/alerts`}>{openAlerts(row)}</Link>
                </strong>
              </div>
              <div>
                <span className="snapshot-label">Incidents</span>
                <strong>
                  <Link href={`/projects/${row.id}/incidents`}>{unresolvedIncidents(row)}</Link>
                </strong>
              </div>
            </div>

            <div className="portfolio-links" aria-label={`Shortcuts for ${row.name}`}>
              <Link href={`/projects/${row.id}`}>Overview</Link>
              <Link href={`/projects/${row.id}/topology`}>Topology</Link>
              <Link href={`/projects/${row.id}/incidents`}>Incidents</Link>
              <Link href={`/projects/${row.id}/alerts`}>Alerts</Link>
              <Link href={`/projects/${row.id}/automation`}>Automation</Link>
              <Link href={`/projects/${row.id}/insights`}>Intelligence</Link>
              <Link href={`/projects/${row.id}/settings`}>Configuration</Link>
            </div>
          </article>
        );
      })}
    </div>
  );
}
