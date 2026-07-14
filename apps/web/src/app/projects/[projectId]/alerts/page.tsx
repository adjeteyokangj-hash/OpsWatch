"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { AlertsTable } from "../../../../components/alerts/alerts-table";
import { EmptyState } from "../../../../components/ui/empty-state";
import { WorkspaceSummaryStrip } from "../../../../components/projects/workspace-summary-strip";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";
import { apiFetch } from "../../../../lib/api";
import { groupAlertsBySignature, type AlertListRow } from "../../../../components/alerts/alert-grouping";

export default function ProjectAlertsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, loading, error } = useProjectWorkspace(projectId);
  const [alerts, setAlerts] = useState<AlertListRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [groupMode, setGroupMode] = useState(true);

  useEffect(() => {
    const load = async () => {
      setListLoading(true);
      try {
        const rows = await apiFetch<AlertListRow[]>(`/alerts?projectId=${projectId}`);
        setAlerts(rows);
      } catch {
        setAlerts([]);
      } finally {
        setListLoading(false);
      }
    };
    if (projectId) void load();
  }, [projectId]);

  const groups = useMemo(() => groupAlertsBySignature(alerts), [alerts]);
  const openCount = alerts.filter((row) => row.status === "OPEN" || row.status === "ACKNOWLEDGED").length;

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title={project ? `${project.name} — Alerts` : "Alerts"}
      subtitle="Severity, first/last seen, and linked incidents. Grouping uses exact title + source + service signatures."
      project={project}
      loading={loading}
      error={error}
      actions={
        <button type="button" className="secondary-button" onClick={() => setGroupMode((value) => !value)}>
          {groupMode ? "Show flat list" : "Group similar"}
        </button>
      }
    >
      <WorkspaceSummaryStrip
        cards={[
          { key: "total", label: "Alerts", value: listLoading ? "…" : alerts.length, tone: "info" },
          { key: "open", label: "Unresolved", value: listLoading ? "…" : openCount, tone: openCount ? "critical" : "healthy" },
          { key: "groups", label: "Groups", value: listLoading ? "…" : groups.length, tone: "info" }
        ]}
      />

      {listLoading ? <section className="panel">Loading alerts…</section> : null}
      {!listLoading && alerts.length === 0 ? (
        <EmptyState title="No alerts for this application" description="Alerts appear from checks, heartbeats, and ingest events." />
      ) : null}
      {!listLoading && alerts.length > 0 && groupMode ? (
        <div className="activity-feed">
          {groups.map((group) => (
            <article className="activity-feed-item" key={group.key}>
              <div className="activity-feed-head">
                <span className="meta-chip">{group.severity}</span>
                <span className="meta-chip">{group.count}×</span>
                {group.linkedIncident ? (
                  <Link href={`/incidents/${group.linkedIncident.id}`} className="meta-chip">
                    Incident
                  </Link>
                ) : null}
              </div>
              <div className="activity-feed-title">
                <Link href={`/alerts/${group.latestId}`}>{group.title}</Link>
              </div>
              <p className="activity-feed-meta">
                {group.sourceType}
                {group.serviceName ? ` · ${group.serviceName}` : ""} · first{" "}
                {new Date(group.firstSeenAt).toLocaleString()} · last {new Date(group.lastSeenAt).toLocaleString()}
              </p>
            </article>
          ))}
        </div>
      ) : null}
      {!listLoading && alerts.length > 0 && !groupMode ? <AlertsTable rows={alerts} /> : null}

      <p>
        <Link className="text-link" href={`/alerts?projectId=${projectId}`}>
          Open global alerts filter →
        </Link>
      </p>
    </ProjectWorkspaceShell>
  );
}
