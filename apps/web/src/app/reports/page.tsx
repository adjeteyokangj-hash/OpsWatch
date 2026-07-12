"use client";

import Link from "next/link";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";

const reports = [
  { title: "Operations analytics", href: "/analytics/operations", description: "Incident volume, MTTR, and operational throughput." },
  { title: "Product insights", href: "/insights", description: "Recommendations and monitoring coverage gaps." },
  { title: "Check accuracy", href: "/accuracy", description: "Automation action accuracy and false-positive trends." },
  { title: "Public status", href: "/status", description: "Customer-facing status pages and comms." }
];

export default function ReportsPage() {
  return (
    <Shell>
      <Header title="Reports" />
      <p className="dashboard-subtle">Operational and reliability reporting across the estate.</p>
      <section className="automation-hub-grid">
        {reports.map((report) => (
          <Link key={report.href} href={report.href} className="panel automation-hub-card">
            <h2>{report.title}</h2>
            <p>{report.description}</p>
          </Link>
        ))}
      </section>
    </Shell>
  );
}
