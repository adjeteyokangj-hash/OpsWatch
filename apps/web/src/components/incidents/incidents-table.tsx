"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { SeverityBadge } from "../alerts/severity-badge";

export function IncidentsTable({ rows }: { rows: Array<any> }) {
  const router = useRouter();
  const stopRowNavigation = (event: MouseEvent) => event.stopPropagation();

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Severity</th>
          <th>Status</th>
          <th>Title</th>
          <th>Project</th>
          <th>Opened</th>
          <th>Resolved</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="row-link" onClick={() => router.push(`/incidents/${row.id}`)} data-action="local-ui">
            <td><SeverityBadge severity={row.severity} /></td>
            <td><span className={`result-pill ${row.status === "RESOLVED" ? "pass" : row.status === "OPEN" ? "fail" : "warn"}`}>{row.status}</span></td>
            <td>
              <Link href={`/incidents/${row.id}`} onClick={stopRowNavigation} data-action="local-ui">{row.title}</Link>
              <div className="table-subtle">{row.resolvedAt ? "Historical incident" : "Active incident"}</div>
            </td>
            <td>{row.project?.id ? <Link href={`/projects/${row.project.id}`} onClick={stopRowNavigation} data-action="local-ui">{row.project?.name}</Link> : "-"}</td>
            <td>{new Date(row.openedAt).toLocaleString()}</td>
            <td>{row.resolvedAt ? new Date(row.resolvedAt).toLocaleString() : "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
