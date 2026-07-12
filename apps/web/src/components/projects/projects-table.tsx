"use client";

import Link from "next/link";
import { formatRelativeTime } from "../../lib/relative-time";
import { healthLabel, healthTone } from "../../lib/health-tones";

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

const unresolvedIncidents = (row: any): number =>
  (row.incidents || []).filter((incident: any) => incident.status !== "RESOLVED").length;

export function ProjectsTable({ rows }: { rows: Array<any> }) {
  return (
    <div className="projects-table-wrap">
      <table className="data-table projects-table">
        <thead>
          <tr>
            <th>Application</th>
            <th>Client</th>
            <th>Environment</th>
            <th>Status</th>
            <th>Last heartbeat</th>
            <th>Modules</th>
            <th>Alerts</th>
            <th>Incidents</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const heartbeat = lastHeartbeatAt(row);
            const label = displayHealth(row);
            const tone = healthTone(row.status);

            return (
              <tr key={row.id}>
                <td data-label="Application">
                  <Link href={`/projects/${row.id}`}>{row.name}</Link>
                </td>
                <td data-label="Client">{row.clientName || "—"}</td>
                <td data-label="Environment">{row.environment}</td>
                <td data-label="Status">
                  <div className="application-health-cell">
                    <span className={`result-pill pill ${tone}`}>
                      {statusEmoji(row.status)} {label}
                    </span>
                    <span className="application-health-meta">
                      Last heartbeat {formatRelativeTime(heartbeat)}
                    </span>
                  </div>
                </td>
                <td data-label="Last heartbeat">{formatRelativeTime(heartbeat)}</td>
                <td data-label="Modules">{moduleCount(row)}</td>
                <td data-label="Alerts">
                  <Link href={`/alerts?projectId=${row.id}&status=OPEN`}>{row.alerts?.length || 0}</Link>
                </td>
                <td data-label="Incidents">
                  <Link href={`/incidents?projectId=${row.id}&onlyUnresolved=true`}>{unresolvedIncidents(row)}</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
