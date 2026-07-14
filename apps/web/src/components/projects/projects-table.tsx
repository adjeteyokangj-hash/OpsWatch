"use client";

import Link from "next/link";
import { formatRelativeTime } from "../../lib/relative-time";
import { healthLabel, healthTone } from "../../lib/health-tones";
import { StatusBadge } from "../ui/status-badge";

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

const displayHealth = (row: any): string => {
  if (row.status === "UNKNOWN" && !row.lastSignalAt && !(row.heartbeats?.length)) {
    return "Waiting for first heartbeat";
  }
  return healthLabel(row.status, row.healthDisplayLabel);
};

const lastHeartbeatAt = (row: any): string | null => {
  const heartbeat = row.heartbeats?.[0]?.receivedAt;
  if (heartbeat) return heartbeat;
  if (row.lastSignalAt) return row.lastSignalAt;
  return null;
};

const moduleCount = (row: any): number => {
  const services = row.services ?? row.Service ?? [];
  const modules = services.filter((service: any) => String(service.type).toUpperCase() === "MODULE");
  if (modules.length > 0) return modules.length;
  return row.monitoredAreaCount ?? 0;
};

const serviceCount = (row: any): number => (row.services ?? row.Service ?? []).length;

const unresolvedIncidents = (row: any): number =>
  (row.incidents || []).filter((incident: any) => incident.status !== "RESOLVED").length;

const openAlerts = (row: any): number =>
  (row.alerts || []).filter((alert: any) => alert.status === "OPEN" || alert.status === "ACKNOWLEDGED").length;

/**
 * Risk column only when there is live evidence (open alerts / unresolved incidents).
 * Never invents a predictive risk score.
 */
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

export function ProjectsTable({ rows }: { rows: Array<any> }) {
  return (
    <div className="projects-table-wrap">
      <table className="data-table projects-table">
        <thead>
          <tr>
            <th>Application</th>
            <th>Client</th>
            <th>Env</th>
            <th>Health</th>
            <th>Risk (evidence)</th>
            <th>Heartbeat</th>
            <th>Modules</th>
            <th>Services</th>
            <th>Alerts</th>
            <th>Incidents</th>
            <th>Links</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const heartbeat = lastHeartbeatAt(row);
            const label = displayHealth(row);
            const tone = healthTone(row.status);
            const risk = evidenceRisk(row);

            return (
              <tr key={row.id}>
                <td data-label="Application">
                  <Link href={`/projects/${row.id}`}>{row.name}</Link>
                </td>
                <td data-label="Client">{row.clientName || "—"}</td>
                <td data-label="Env">{row.environment}</td>
                <td data-label="Health">
                  <div className="application-health-cell">
                    <span className={`result-pill pill ${tone}`}>
                      {statusEmoji(row.status)} {label}
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
                <td data-label="Links">
                  <div className="portfolio-links">
                    <Link href={`/projects/${row.id}/topology`}>Topology</Link>
                    <Link href={`/projects/${row.id}/automation`}>Automation</Link>
                    <Link href={`/projects/${row.id}/deployments`}>Deploys</Link>
                    <Link href={`/projects/${row.id}/insights`}>Insights</Link>
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
