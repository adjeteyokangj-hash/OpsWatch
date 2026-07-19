"use client";

import Link from "next/link";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { ProductTruthStatus } from "../../components/ui/product-truth-status";

export default function SecurityPage() {
  return (
    <Shell>
      <Header title="Security" />
      <section className="panel" data-testid="security-foundation-state">
        <div className="panel-heading-row">
          <div>
            <h2>Security foundation</h2>
            <p className="dashboard-subtle">
              Current coverage protects access to OpsWatch and its credentials. It is not application threat
              detection.
            </p>
          </div>
          <ProductTruthStatus state="Foundation" />
        </div>
        <p>
          Existing evidence categories include authentication and role controls, credential expiry and rotation,
          signed ingest replay protection, audit activity, and automation policy boundaries.
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
      <section className="panel">
        <h2>Threat coverage not available</h2>
        <p>
          No vulnerability findings, attack paths, workload threat detections, risk scores, or containment
          actions are produced. Phase 8 requires verified security-event, identity, API-abuse, privilege-change,
          asset, and vulnerability evidence sources before those claims can appear.
        </p>
        <ProductTruthStatus state="Requires connection" detail="Phase 8 security evidence sources are not connected." />
      </section>
    </Shell>
  );
}
