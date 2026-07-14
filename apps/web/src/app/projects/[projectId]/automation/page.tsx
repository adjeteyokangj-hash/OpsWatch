"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { WorkspaceSummaryStrip } from "../../../../components/projects/workspace-summary-strip";
import { EmptyState } from "../../../../components/ui/empty-state";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";
import { apiFetch } from "../../../../lib/api";

type HistoryItem = {
  id: string;
  incidentId: string;
  projectId: string;
  triggerType: string | null;
  reason: string | null;
  action: string | null;
  status: string;
  success: boolean | null;
  verificationStatus: string | null;
  createdAt: string;
};

export default function ProjectAutomationPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, loading, error } = useProjectWorkspace(projectId);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const payload = await apiFetch<{ items: HistoryItem[] }>("/intelligence/automation-history?limit=50");
        setItems((payload.items ?? []).filter((row) => row.projectId === projectId));
      } catch (err: unknown) {
        setHistoryError(err instanceof Error ? err.message : "Failed to load automation history");
      } finally {
        setHistoryLoading(false);
      }
    };
    if (projectId) void load();
  }, [projectId]);

  const succeeded = items.filter((row) => row.success === true).length;
  const failed = items.filter((row) => row.success === false).length;
  const pending = items.filter((row) =>
    ["PENDING_APPROVAL", "AWAITING_APPROVAL", "PLANNED", "APPROVAL_PENDING"].includes(row.status)
  ).length;
  const successRate =
    succeeded + failed === 0 ? null : Math.round((succeeded / (succeeded + failed)) * 100);

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title={project ? `${project.name} — Automation` : "Project Automation"}
      subtitle="Playbooks, verification, and run history for this application — real outcomes only."
      project={project}
      loading={loading}
      error={error}
    >
      <WorkspaceSummaryStrip
        cards={[
          { key: "runs", label: "Runs (loaded)", value: historyLoading ? "…" : items.length, tone: "info" },
          {
            key: "success",
            label: "Success rate",
            value: historyLoading ? "…" : successRate == null ? "—" : `${successRate}%`,
            tone: successRate == null ? "info" : successRate >= 80 ? "healthy" : "degraded"
          },
          { key: "failed", label: "Failed", value: historyLoading ? "…" : failed, tone: failed > 0 ? "critical" : "healthy" },
          { key: "pending", label: "Pending / planned", value: historyLoading ? "…" : pending, tone: pending > 0 ? "degraded" : "info" }
        ]}
      />

      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Configure</h2>
            <p className="dashboard-subtle">Estate-wide playbooks and policies apply to this application.</p>
          </div>
        </div>
        <div className="quick-link-grid">
          <Link className="quick-link-card" href="/automation/playbooks">
            <strong>Playbooks</strong>
            <span>Versioned remediation playbooks with approval workflow.</span>
          </Link>
          <Link className="quick-link-card" href="/auto-run-policy">
            <strong>Auto-run policy</strong>
            <span>When autonomous actions may execute without approval.</span>
          </Link>
          <Link className="quick-link-card" href="/accuracy">
            <strong>Accuracy</strong>
            <span>Recorded prediction vs outcome for remediation actions.</span>
          </Link>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Recent automation history</h2>
            <p className="dashboard-subtle">Filtered to this application from org automation runs.</p>
          </div>
        </div>
        {historyError ? <p className="error-panel">{historyError}</p> : null}
        {historyLoading ? <p>Loading automation history…</p> : null}
        {!historyLoading && items.length === 0 ? (
          <EmptyState
            title="No automation runs for this application"
            description="Runs appear after playbooks are planned or executed against this project's incidents."
          />
        ) : null}
        {!historyLoading && items.length > 0 ? (
          <div className="activity-feed">
            {items.slice(0, 15).map((row) => (
              <article className="activity-feed-item" key={row.id}>
                <div className="activity-feed-head">
                  <StatusBadge
                    label={row.success == null ? row.status : row.success ? "Success" : "Failed"}
                    tone={row.success === true ? "success" : row.success === false ? "danger" : "neutral"}
                  />
                  {row.triggerType ? <span className="meta-chip">{row.triggerType}</span> : null}
                </div>
                <div className="activity-feed-title">
                  <Link href={`/incidents/${row.incidentId}`}>{row.reason || row.action || "Automation run"}</Link>
                </div>
                <p className="activity-feed-meta">
                  {new Date(row.createdAt).toLocaleString()}
                  {row.verificationStatus ? ` · verify ${row.verificationStatus}` : ""}
                </p>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </ProjectWorkspaceShell>
  );
}
