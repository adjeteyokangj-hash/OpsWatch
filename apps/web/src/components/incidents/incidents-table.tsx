"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { SeverityBadge } from "../alerts/severity-badge";

type IncidentRow = {
  id: string;
  title: string;
  severity: string;
  status: string;
  openedAt: string;
  resolvedAt: string | null;
  rootCause?: string | null;
  owner?: string | null;
  alertCount?: number;
  affectedServices?: Array<{ id: string; name: string }>;
  correlatedDeployCount?: number;
  project?: { id: string; name: string; owner?: string | null };
};

export function IncidentsTable({
  rows,
  onSelectRow,
  selectedId
}: {
  rows: IncidentRow[];
  onSelectRow?: (id: string) => void;
  selectedId?: string | null;
}) {
  const router = useRouter();
  const stopRowNavigation = (event: MouseEvent) => event.stopPropagation();

  return (
    <div className="table-cards-wrap">
      <table className="data-table table-cards incidents-table">
        <thead>
          <tr>
            <th>Severity</th>
            <th>Status</th>
            <th>Title</th>
            <th>Owner</th>
            <th>Scope</th>
            <th>Alerts</th>
            <th>Deploys</th>
            <th>Project</th>
            <th>Opened</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const owner = row.owner || row.project?.owner || null;
            const scope =
              (row.affectedServices ?? []).length === 0
                ? "—"
                : (row.affectedServices ?? [])
                    .slice(0, 2)
                    .map((service) => service.name)
                    .join(", ") +
                  ((row.affectedServices ?? []).length > 2
                    ? ` +${(row.affectedServices ?? []).length - 2}`
                    : "");

            return (
              <tr
                key={row.id}
                className={`row-link${selectedId === row.id ? " row-selected" : ""}`}
                onClick={() => {
                  if (onSelectRow) onSelectRow(row.id);
                  else router.push(`/incidents/${row.id}`);
                }}
                data-action="local-ui"
              >
                <td data-label="Severity">
                  <SeverityBadge severity={row.severity} />
                </td>
                <td data-label="Status">
                  <span
                    className={`result-pill ${
                      row.status === "RESOLVED" ? "pass" : row.status === "OPEN" ? "fail" : "warn"
                    }`}
                  >
                    {row.status}
                  </span>
                </td>
                <td data-label="Title">
                  <Link href={`/incidents/${row.id}`} onClick={stopRowNavigation} data-action="local-ui">
                    {row.title}
                  </Link>
                  <div className="table-subtle">
                    {row.rootCause ? `Root cause recorded` : row.resolvedAt ? "Historical" : "Active"}
                  </div>
                </td>
                <td data-label="Owner">{owner || "Unassigned"}</td>
                <td data-label="Scope">{scope}</td>
                <td data-label="Alerts">{row.alertCount ?? "—"}</td>
                <td data-label="Deploys">
                  {row.correlatedDeployCount && row.correlatedDeployCount > 0
                    ? row.correlatedDeployCount
                    : "—"}
                </td>
                <td data-label="Project">
                  {row.project?.id ? (
                    <Link
                      href={`/projects/${row.project.id}`}
                      onClick={stopRowNavigation}
                      data-action="local-ui"
                    >
                      {row.project?.name}
                    </Link>
                  ) : (
                    "-"
                  )}
                </td>
                <td data-label="Opened">{new Date(row.openedAt).toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
