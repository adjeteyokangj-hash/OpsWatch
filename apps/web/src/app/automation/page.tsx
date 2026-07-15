"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { PageSection } from "../../components/ui/page-section";
import { EmptyState } from "../../components/ui/empty-state";
import { StatusBadge } from "../../components/ui/status-badge";
import { StatCard } from "../../components/dashboard/stat-card";
import { apiFetch } from "../../lib/api";

type HistoryItem = {
  id: string;
  incidentId: string;
  projectId: string;
  triggerType: string | null;
  reason: string | null;
  action: string | null;
  status: string;
  durationMs: number | null;
  success: boolean | null;
  verificationStatus: string | null;
  confidence: number | null;
  executionMode: string;
  createdAt: string;
};

const cards = [
  {
    title: "Playbooks",
    description: "Versioned remediation and response playbooks with approval workflow.",
    href: "/automation/playbooks"
  },
  {
    title: "Auto-Run Policy",
    description: "Govern when autonomous actions may execute without human approval.",
    href: "/auto-run-policy"
  },
  {
    title: "Accuracy & Actions",
    description: "Review automation accuracy, action outcomes, and operator overrides.",
    href: "/accuracy"
  },
  {
    title: "Intelligence audit",
    description: "AI decision and recovery audit trail grounded in real evidence.",
    href: "/intelligence"
  }
];

export default function AutomationHubPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [gates, setGates] = useState<Array<{ key: string; enabled: boolean; description: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [payload, gatePayload] = await Promise.all([
          apiFetch<{ items: HistoryItem[] }>("/intelligence/automation-history?limit=20"),
          apiFetch<{ gates: Array<{ key: string; enabled: boolean; description: string }> }>(
            "/intelligence/feature-gates"
          ).catch(() => ({ gates: [] }))
        ]);
        setItems(payload.items ?? []);
        setGates(
          (gatePayload.gates ?? []).filter((gate) =>
            ["AUTO_REPAIR", "AUTOMATION_TEST_MODE", "PREDICTIONS"].includes(gate.key)
          )
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load automation history");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const succeeded = items.filter((row) => row.success === true).length;
  const failed = items.filter((row) => row.success === false).length;
  const pendingApproval = items.filter((row) =>
    ["PENDING_APPROVAL", "AWAITING_APPROVAL", "PLANNED"].includes(row.status)
  ).length;
  const successRate =
    succeeded + failed === 0 ? null : Math.round((succeeded / (succeeded + failed)) * 100);

  return (
    <Shell>
      <Header title="Automation Centre" />
      <p className="dashboard-subtle">
        Playbooks, approvals, verification, and evidence-backed run history. High-impact auto-repair stays blocked unless explicitly enabled.
      </p>

      {gates.length > 0 ? (
        <PageSection title="Controlled automation gates" description="Live flags for repair and prediction emission.">
          <div className="feature-gate-grid">
            {gates.map((gate) => (
              <article className="feature-gate-card" key={gate.key}>
                <strong>{gate.key.replace(/_/g, " ")}</strong>
                <StatusBadge label={gate.enabled ? "Enabled" : "Off"} tone={gate.enabled ? "warning" : "muted"} />
                <p className="dashboard-subtle">{gate.description}</p>
              </article>
            ))}
          </div>
        </PageSection>
      ) : null}

      <section className="grid-6 dashboard-metrics">
        <StatCard label="Recent runs" value={loading ? "-" : items.length} />
        <StatCard label="Succeeded" value={loading ? "-" : succeeded} />
        <StatCard label="Failed" value={loading ? "-" : failed} />
        <StatCard label="Pending / planned" value={loading ? "-" : pendingApproval} />
        <StatCard label="Success rate" value={loading ? "-" : successRate == null ? "—" : `${successRate}%`} />
        <StatCard label="Checks" value="→" href="/checks" />
      </section>

      <section className="automation-hub-grid">
        {cards.map((card) => (
          <Link key={card.href} href={card.href} className="panel automation-hub-card">
            <h2>{card.title}</h2>
            <p>{card.description}</p>
          </Link>
        ))}
      </section>

      <PageSection title="Recent automation history" description="Trigger, reason, action, verification, and success from real runs.">
        {error ? <p className="error-panel">{error}</p> : null}
        {loading ? <p>Loading automation history…</p> : null}
        {!loading && items.length === 0 ? (
          <EmptyState
            title="No automation runs yet"
            description="Runs appear after playbooks are planned or executed against incidents."
            action={<Link className="primary-button" href="/automation/playbooks">Open playbooks</Link>}
          />
        ) : null}
        {!loading && items.length > 0 ? (
          <div className="table-cards-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Status</th>
                  <th>Trigger</th>
                  <th>Action</th>
                  <th>Reason</th>
                  <th>Verify</th>
                  <th>Incident</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td data-label="When">{new Date(row.createdAt).toLocaleString()}</td>
                    <td data-label="Status">
                      <StatusBadge
                        label={row.success == null ? row.status : row.success ? "Success" : "Failed"}
                        tone={row.success === true ? "success" : row.success === false ? "danger" : "neutral"}
                      />
                    </td>
                    <td data-label="Trigger">{row.triggerType || row.executionMode}</td>
                    <td data-label="Action">{row.action || "—"}</td>
                    <td data-label="Reason">{row.reason || "—"}</td>
                    <td data-label="Verify">{row.verificationStatus || "—"}</td>
                    <td data-label="Incident">
                      <Link href={`/incidents/${row.incidentId}`}>{row.incidentId.slice(0, 8)}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </PageSection>
    </Shell>
  );
}
