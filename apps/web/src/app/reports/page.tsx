"use client";

import Link from "next/link";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { StatusBadge } from "../../components/ui/status-badge";

const reports = [
  { title: "Operations analytics", href: "/analytics/operations", status: "Live calculated", tone: "success" as const, description: "Counts and time-window calculations from persisted incidents and automation runs." },
  { title: "Product insights", href: "/insights", status: "Preview", tone: "warning" as const, description: "Deterministic coverage calculations and recommendations; not learned AI predictions." },
  { title: "Remediation accuracy", href: "/accuracy", status: "Live calculated", tone: "success" as const, description: "Calculated only when persisted remediation outcomes exist; otherwise unavailable." },
  { title: "Public status", href: "/status", status: "Requires configuration", tone: "muted" as const, description: "Recorded incidents can be published after a status page is configured." }
];

export default function ReportsPage() {
  return (
    <Shell>
      <Header title="Reports" />
      <p className="dashboard-subtle">Every report identifies whether it is persisted, calculated, preview, or unavailable.</p>
      <section className="automation-hub-grid" data-testid="reports-truth-state">
        {reports.map((report) => (
          <Link key={report.href} href={report.href} className="panel automation-hub-card">
            <div className="panel-heading-row">
              <h2>{report.title}</h2>
              <StatusBadge label={report.status} tone={report.tone} />
            </div>
            <p>{report.description}</p>
          </Link>
        ))}
      </section>
    </Shell>
  );
}
