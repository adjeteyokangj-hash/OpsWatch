import Link from "next/link";
import { HealthBadge } from "../health/health-badge";
import { WorkspaceSummaryStrip } from "./workspace-summary-strip";

type CheckRow = {
  id: string;
  name: string;
  latestResult?: { status: string; checkedAt: string } | null;
};

const checkStatusTone = (status: string): string => {
  if (status === "PASS") return "HEALTHY";
  if (status === "FAIL") return "DOWN";
  if (status === "WARN") return "DEGRADED";
  return "UNKNOWN";
};

export function CheckResultsTable({ rows }: { rows: CheckRow[] }) {
  const summary = rows.reduce(
    (acc, row) => {
      const status = row.latestResult?.status || "PENDING";
      if (status === "PASS") acc.pass += 1;
      else if (status === "FAIL") acc.fail += 1;
      else if (status === "WARN") acc.warn += 1;
      else acc.pending += 1;
      return acc;
    },
    { pass: 0, fail: 0, warn: 0, pending: 0 }
  );

  if (rows.length === 0) {
    return (
      <section className="panel workspace-empty-state">
        <h2>Checks</h2>
        <p>No checks found for this project yet.</p>
      </section>
    );
  }

  return (
    <>
      <WorkspaceSummaryStrip
        cards={[
          { key: "total", label: "Total checks", value: rows.length, tone: "info" },
          { key: "pass", label: "Healthy", value: summary.pass, tone: "healthy" },
          { key: "warn", label: "Warning", value: summary.warn, tone: "degraded" },
          { key: "fail", label: "Critical", value: summary.fail, tone: "critical" },
          { key: "pending", label: "Pending", value: summary.pending, tone: "neutral" }
        ]}
      />
      <section className="panel workspace-section-card">
        <div className="section-head">
          <div>
            <h2>Recent checks</h2>
            <p className="dashboard-subtle">{rows.length} monitoring check{rows.length === 1 ? "" : "s"} for this application.</p>
          </div>
        </div>
        <div className="layer-health-table-wrap">
          <table className="data-table check-results-table">
            <thead>
              <tr>
                <th>Check</th>
                <th>Status</th>
                <th>Last run</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((check) => {
                const status = check.latestResult?.status || "PENDING";
                return (
                  <tr key={check.id}>
                    <td data-label="Check">
                      <strong>{check.name}</strong>
                    </td>
                    <td data-label="Status">
                      <HealthBadge status={checkStatusTone(status)} displayLabel={status} />
                    </td>
                    <td data-label="Last run">{check.latestResult?.checkedAt ? new Date(check.latestResult.checkedAt).toLocaleString() : "—"}</td>
                    <td data-label="Actions">
                      <Link className="text-link" href={`/checks/${check.id}`}>
                        View details
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
