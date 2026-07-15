"use client";

import Link from "next/link";
import { formatRelativeTime } from "../../lib/relative-time";
import { healthLabel, healthTone } from "../../lib/health-tones";
import { StatusBadge } from "../ui/status-badge";
import { ApplicationActionsMenu } from "./application-actions-menu";
import {
  isTestApplication,
  shortApplicationRef,
  type ApplicationRow
} from "../../lib/applications-browse";

const lastSeenAt = (row: ApplicationRow): string | null => {
  const heartbeats = row.heartbeats as Array<{ receivedAt?: string }> | undefined;
  const heartbeat = heartbeats?.[0]?.receivedAt;
  if (heartbeat) return heartbeat;
  if (typeof row.lastSignalAt === "string") return row.lastSignalAt;
  if (typeof row.lastCompletedCheckAt === "string") return row.lastCompletedCheckAt;
  return null;
};

const unresolvedIncidents = (row: ApplicationRow): number =>
  ((row.incidents as Array<{ status?: string }> | undefined) || []).filter(
    (incident) => incident.status !== "RESOLVED"
  ).length;

const openAlerts = (row: ApplicationRow): number =>
  ((row.alerts as Array<{ status?: string }> | undefined) || []).filter(
    (alert) => alert.status === "OPEN" || alert.status === "ACKNOWLEDGED"
  ).length;

const ownershipLabel = (row: ApplicationRow): string =>
  String(row.projectOwner || row.clientName || "Unassigned");

const evidenceRisk = (
  row: ApplicationRow
): { label: string; tone: "danger" | "warning" | "success" | "muted" } => {
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

export function ApplicationsPortfolioCards({ rows }: { rows: ApplicationRow[] }) {
  return (
    <div className="applications-portfolio-grid" role="list">
      {rows.map((row) => {
        const seen = lastSeenAt(row);
        const risk = evidenceRisk(row);
        const label = healthLabel(
          String(row.status || "UNKNOWN"),
          typeof row.healthDisplayLabel === "string" ? row.healthDisplayLabel : undefined
        );
        const tone = healthTone(String(row.status || "UNKNOWN"));
        const waiting =
          row.status === "UNKNOWN" && !seen
            ? "Waiting for first heartbeat or completed check"
            : null;
        const company = ownershipLabel(row);
        const testApp = isTestApplication(row);
        const ref = shortApplicationRef(row);

        return (
          <article
            key={row.id}
            className={`application-portfolio-card panel${testApp ? " is-test-application" : ""}`}
            role="listitem"
          >
            <div className="application-portfolio-card-head">
              <div>
                <div className="application-portfolio-title-row">
                  <h2>
                    <Link href={`/projects/${row.id}`}>{row.name}</Link>
                  </h2>
                  {testApp ? <span className="application-test-badge">Test</span> : null}
                </div>
                <p className="application-portfolio-company">{company}</p>
                <p className="dashboard-subtle application-portfolio-ref">
                  <span className="snapshot-label">ID</span> {ref}
                  <span className="application-portfolio-sep" aria-hidden="true">
                    ·
                  </span>
                  <span className="snapshot-label">Env</span> {row.environment || "—"}
                </p>
              </div>
              <span className={`result-pill pill ${tone}`}>{label}</span>
            </div>

            {waiting ? <p className="application-portfolio-unknown" role="status">{waiting}</p> : null}
            {row.healthReason && row.status !== "HEALTHY" ? (
              <p className="dashboard-subtle">{String(row.healthReason)}</p>
            ) : null}

            <div className="application-portfolio-meta">
              <div>
                <span className="snapshot-label">Last heartbeat</span>
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

            <div className="application-portfolio-actions" aria-label={`Actions for ${row.name}`}>
              <Link className="primary-button" href={`/projects/${row.id}`}>
                Overview
              </Link>
              <Link className="secondary-button" href={`/projects/${row.id}/topology`}>
                Topology
              </Link>
              <ApplicationActionsMenu
                projectId={row.id}
                applicationName={String(row.name || "Application")}
                omitOverview
                omitTopology
              />
            </div>
          </article>
        );
      })}
    </div>
  );
}
