"use client";

import Link from "next/link";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";

export default function SecurityPage() {
  return (
    <Shell>
      <Header title="Security Command Centre" />
      <section className="panel">
        <h2>Security intelligence (Phase 2)</h2>
        <p>
          Security posture scoring, vulnerability signals, and compliance dashboards are planned for the next
          blueprint phase. Current operational security controls live in project settings and automation policy.
        </p>
        <ul className="dashboard-list">
          <li>
            <Link href="/auto-run-policy">Auto-run policy</Link> — governs autonomous remediation boundaries.
          </li>
          <li>
            <Link href="/settings">Organization settings</Link> — roles, notifications, and access controls.
          </li>
          <li>
            <Link href="/members">Members &amp; roles</Link> — OpsWatch platform access management.
          </li>
        </ul>
      </section>
    </Shell>
  );
}
