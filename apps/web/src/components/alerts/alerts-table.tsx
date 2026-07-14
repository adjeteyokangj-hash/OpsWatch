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
            <th>Source</th>
            <th>Project</th>
            <th>Service</th>
            <th>First seen</th>
            <th>Last seen</th>
            <th>Incident</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const linked = row.linkedIncidents?.[0] ?? row.incidents?.[0] ?? null;
            return (
              <tr
                key={row.id}
                className="row-link"
                onClick={() => router.push(`/alerts/${row.id}`)}
                data-action="local-ui"
              >
                <td data-label="Severity">
                  <SeverityBadge severity={row.severity} />
                </td>
                <td data-label="Status">
                  <span
                    className={`result-pill ${
                      row.status === "RESOLVED" ? "pass" : row.status === "ACKNOWLEDGED" ? "warn" : "fail"
                    }`}
                  >
                    {row.status}
                  </span>
                </td>
                <td data-label="Title">
                  <Link href={`/alerts/${row.id}`} onClick={stopRowNavigation} data-action="local-ui">
                    {row.title}
                  </Link>
                  <div className="table-subtle">{row.message}</div>
                </td>
                <td data-label="Source">{row.sourceType}</td>
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
                <td data-label="Service">
                  {row.service?.id ? (
                    <Link
                      href={`/checks?serviceId=${row.service.id}`}
                      onClick={stopRowNavigation}
                      data-action="local-ui"
                    >
                      {row.service?.name}
                    </Link>
                  ) : (
                    "-"
                  )}
                </td>
                <td data-label="First seen">{new Date(row.firstSeenAt).toLocaleString()}</td>
                <td data-label="Last seen">{new Date(row.lastSeenAt).toLocaleString()}</td>
                <td data-label="Incident">
                  {linked?.id ? (
                    <Link href={`/incidents/${linked.id}`} onClick={stopRowNavigation} data-action="local-ui">
                      {linked.title || linked.id.slice(0, 8)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
