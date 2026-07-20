"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HealthBadge } from "./health-badge";
import { PageSection } from "../ui/page-section";

type AppRow = {
  id: string;
  name: string;
  environment: string;
  status: string;
  healthDisplayLabel?: string | null;
  lastSignalAt?: string | null;
  lastCompletedCheckAt?: string | null;
  alerts?: Array<{ id: string }>;
};

export function DashboardAppStatusTable({ rows, loading }: { rows: AppRow[]; loading?: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (loading) {
    return (
      <PageSection title="Application Status" persistKey="org:dashboard:app-status">
        <p>Loading applications…</p>
      </PageSection>
    );
  }

  const signalAt = (row: AppRow) => {
    const ts = row.lastSignalAt || row.lastCompletedCheckAt;
    if (!ts) return "No completed checks";
    if (!mounted) return "—";
    return new Date(ts).toLocaleString();
  };

  return (
    <PageSection
      title="Application Status"
      persistKey="org:dashboard:app-status"
      actions={<Link href="/apps">View all apps</Link>}
    >
      {rows.length === 0 ? (
        <p>No applications configured yet.</p>
      ) : (
        <div className="layer-health-table-wrap">
          <table className="data-table layer-health-table">
            <thead>
              <tr>
                <th>Application</th>
                <th>Environment</th>
                <th>Health</th>
                <th>Last signal</th>
                <th>Open alerts</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 12).map((row) => (
                <tr key={row.id}>
                  <td data-label="Application">
                    <Link href={`/projects/${row.id}`}>{row.name}</Link>
                  </td>
                  <td data-label="Environment">{row.environment}</td>
                  <td data-label="Health">
                    <HealthBadge status={row.status} displayLabel={row.healthDisplayLabel} />
                  </td>
                  <td data-label="Last signal">{signalAt(row)}</td>
                  <td data-label="Open alerts">{row.alerts?.length ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageSection>
  );
}
