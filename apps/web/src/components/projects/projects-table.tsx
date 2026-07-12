"use client";

import Link from "next/link";

const healthClass = (status: string) => {
  if (status === "HEALTHY") return "pass";
  if (status === "DOWN") return "fail";
  if (status === "UNKNOWN") return "unknown";
  if (status === "PAUSED" || status === "MAINTENANCE") return "paused";
  return "warn";
};

const healthToneClass = (status: string) => {
  if (status === "HEALTHY") return "healthy";
  if (status === "DOWN") return "down";
  if (status === "UNKNOWN") return "unknown";
  if (status === "PAUSED" || status === "MAINTENANCE" || status === "RECOVERING") return "paused";
  return "degraded";
};

const displayHealth = (row: any): string => row.healthDisplayLabel ?? row.status;

const projectReason = (row: any): string => {
  if (row.healthReason) return row.healthReason;
  const openAlerts = row.alerts || [];
  if (openAlerts.length > 0) return openAlerts[0].title || "Open alert";
  if (row.status === "UNKNOWN") return "No completed monitoring result";
  return "-";
};

const latestSignal = (row: any): string => {
  if (row.lastSignalAt) return new Date(row.lastSignalAt).toLocaleString();
  if (row.lastCompletedCheckAt) return new Date(row.lastCompletedCheckAt).toLocaleString();
  return "No completed checks";
};

import { formatPrice as formatBillingPrice, formatPlanLabel } from "../../lib/project-billing";

const formatPrice = (row: any): string => {
  const billing = row.billing;
  if (!billing) return "—";
  return formatBillingPrice(billing.monthlyPrice, billing.currency);
};

const formatPlanCell = (row: any): string => {
  const billing = row.billing;
  if (!billing) return "—";
  const label = billing.pricingLabel ?? billing.plan;
  return formatPlanLabel(label);
};

const formatProjectContacts = (row: any): string => {
  const parts: string[] = [];
  if (row.projectOwner?.trim()) {
    parts.push(`Owner: ${row.projectOwner.trim()}`);
  }
  if (row.operationalContact?.trim()) {
    parts.push(row.operationalContact.trim());
  }
  const channels = row.notificationChannels ?? row.NotificationChannel ?? [];
  const emailTargets = channels
    .filter((channel: any) => String(channel.type).toUpperCase() === "EMAIL" && channel.target)
    .map((channel: any) => String(channel.target));
  if (emailTargets.length > 0) {
    parts.push(...emailTargets);
  }
  return parts.length > 0 ? parts.join(" · ") : "—";
};

export function ProjectsTable({ rows }: { rows: Array<any> }) {
  return (
    <div className="projects-table-wrap">
      <table className="data-table projects-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Client</th>
            <th>Env</th>
            <th>Health</th>
            <th>Reason</th>
            <th>Monitored Areas</th>
            <th>Plan</th>
            <th>Monthly Price</th>
            <th>Last Signal</th>
            <th>Contacts</th>
            <th>Alerts</th>
            <th>Incidents</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td data-label="Project">
                <Link href={`/projects/${row.id}`}>{row.name}</Link>
              </td>
              <td data-label="Client">{row.clientName}</td>
              <td data-label="Environment">{row.environment}</td>
              <td data-label="Health">
                <span className={`result-pill ${healthClass(row.status)} pill ${healthToneClass(row.status)}`}>
                  {displayHealth(row)}
                </span>
              </td>
              <td data-label="Reason">{projectReason(row)}</td>
              <td data-label="Monitored areas">{row.monitoredAreaCount ?? row.services?.length ?? 0}</td>
              <td data-label="Plan">{formatPlanCell(row)}</td>
              <td data-label="Monthly price">{formatPrice(row)}</td>
              <td data-label="Last signal">{latestSignal(row)}</td>
              <td data-label="Contacts">{formatProjectContacts(row)}</td>
              <td data-label="Alerts">
                <Link href={`/alerts?projectId=${row.id}&status=OPEN`}>{row.alerts?.length || 0}</Link>
              </td>
              <td data-label="Incidents">
                <Link href={`/incidents?projectId=${row.id}&onlyUnresolved=true`}>
                  {(row.incidents || []).filter((incident: any) => incident.status !== "RESOLVED").length}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
