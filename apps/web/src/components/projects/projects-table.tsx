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

const statusEmoji = (status: string): string => {
  if (status === "HEALTHY") return "🟢";
  if (status === "DOWN") return "🔴";
  if (status === "DEGRADED") return "🟡";
  if (status === "UNKNOWN") return "⚪";
  if (status === "PAUSED") return "⏸";
  if (status === "MAINTENANCE") return "🛠";
  if (status === "RECOVERING") return "🔄";
  return "⚪";
};

const displayHealth = (row: ApplicationRow): string => {
  const heartbeats = row.heartbeats as Array<unknown> | undefined;
  if (row.status === "UNKNOWN" && !row.lastSignalAt && !(heartbeats?.length)) {
    return "Waiting for first heartbeat";
  }
  return healthLabel(
    String(row.status || "UNKNOWN"),
    typeof row.healthDisplayLabel === "string" ? row.healthDisplayLabel : undefined
  );
};

const lastHeartbeatAt = (row: ApplicationRow): string | null => {
  const heartbeats = row.heartbeats as Array<{ receivedAt?: string }> | undefined;
  const heartbeat = heartbeats?.[0]?.receivedAt;
  if (heartbeat) return heartbeat;
  if (typeof row.lastSignalAt === "string") return row.lastSignalAt;
  return null;
};

const moduleCount = (row: ApplicationRow): number => {
  const services = (row.services ?? row.Service ?? []) as Array<{ type?: string }>;
  const modules = services.filter((service) => String(service.type).toUpperCase() === "MODULE");
  if (modules.length > 0) return modules.length;
  return typeof row.monitoredAreaCount === "number" ? row.monitoredAreaCount : 0;
};

const serviceCount = (row: ApplicationRow): number =>
  ((row.services ?? row.Service ?? []) as Array<unknown>).length;

const unresolvedIncidents = (row: ApplicationRow): number =>
  ((row.incidents as Array<{ status?: string }> | undefined) || []).filter(
    (incident) => incident.status !== "RESOLVED"
  ).length;

const openAlerts = (row: ApplicationRow): number =>
  ((row.alerts as Array<{ status?: string }> | undefined) || []).filter(
    (alert) => alert.status === "OPEN" || alert.status === "ACKNOWLEDGED"
  ).length;

/**
 * Risk column only when there is live evidence (open alerts / unresolved incidents).
 * Never invents a predictive risk score.
 */
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

export function ProjectsTable({ rows }: { rows: ApplicationRow[] }) {
  return (
    <div className="projects-table-wrap">
      <table className="data-table projects-table">
        <thead>
          <tr>
            <th>Application</th>
            <th>Owner</th>
            <th>Env</th>
            <th>Health</th>
            <th>Risk (evidence)</th>
            <th>Heartbeat</th>
            <th>Modules</th>
            <th>Services</th>
            <th>Alerts</th>
            <th>Incidents</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const heartbeat = lastHeartbeatAt(row);
            const label = displayHealth(row);
            const tone = healthTone(String(row.status || "UNKNOWN"));
            const risk = evidenceRisk(row);
            const testApp = isTestApplication(row);
            const ref = shortApplicationRef(row);

            return (
              <tr key={row.id} className={testApp ? "is-test-application" : undefined}>
                <td data-label="Application">
                  <div className="application-table-name">
                    <Link href={`/projects/${row.id}`}>{row.name}</Link>
                    {testApp ? <span className="application-test-badge">Test</span> : null}
                  </div>
                  <div className="dashboard-subtle application-table-ref">{ref}</div>
                </td>
                <td data-label="Client">{row.projectOwner || row.clientName || "—"}</td>
                <td data-label="Env">{row.environment}</td>
                <td data-label="Health">
                  <div className="application-health-cell">
                    <span className={`result-pill pill ${tone}`}>
                      {statusEmoji(String(row.status || "UNKNOWN"))} {label}
                    </span>
                  </div>
                </td>
                <td data-label="Risk">
                  <StatusBadge label={risk.label} tone={risk.tone} />
                </td>
                <td data-label="Heartbeat">{formatRelativeTime(heartbeat)}</td>
                <td data-label="Modules">{moduleCount(row)}</td>
                <td data-label="Services">{serviceCount(row)}</td>
                <td data-label="Alerts">
                  <Link href={`/projects/${row.id}/alerts`}>{openAlerts(row)}</Link>
                </td>
                <td data-label="Incidents">
                  <Link href={`/projects/${row.id}/incidents`}>{unresolvedIncidents(row)}</Link>
                </td>
                <td data-label="Actions">
                  <div className="application-table-actions">
                    <Link className="secondary-button" href={`/projects/${row.id}`}>
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
