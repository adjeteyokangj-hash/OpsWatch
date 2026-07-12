"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { SeverityBadge } from "./severity-badge";

export function AlertsTable({ rows }: { rows: Array<any> }) {
  const router = useRouter();
  const stopRowNavigation = (event: MouseEvent) => event.stopPropagation();

  return (
    <div className="table-cards-wrap">
      <table className="data-table table-cards alerts-table">
        <thead>
          <tr>
            <th>Severity</th>
            <th>Status</th>
            <th>Title</th>
            <th>Project</th>
            <th>Service</th>
            <th>Last Seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="row-link" onClick={() => router.push(`/alerts/${row.id}`)} data-action="local-ui">
              <td data-label="Severity"><SeverityBadge severity={row.severity} /></td>
              <td data-label="Status"><span className={`result-pill ${row.status === "RESOLVED" ? "pass" : row.status === "ACKNOWLEDGED" ? "warn" : "fail"}`}>{row.status}</span></td>
              <td data-label="Title">
                <Link href={`/alerts/${row.id}`} onClick={stopRowNavigation} data-action="local-ui">{row.title}</Link>
                <div className="table-subtle">{row.message}</div>
              </td>
              <td data-label="Project">
                {row.project?.id ? <Link href={`/projects/${row.project.id}`} onClick={stopRowNavigation} data-action="local-ui">{row.project?.name}</Link> : "-"}
              </td>
              <td data-label="Service">
                {row.service?.id ? <Link href={`/checks?serviceId=${row.service.id}`} onClick={stopRowNavigation} data-action="local-ui">{row.service?.name}</Link> : "-"}
              </td>
              <td data-label="Last seen">{new Date(row.lastSeenAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
