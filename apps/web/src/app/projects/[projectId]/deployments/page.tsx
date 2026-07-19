"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { EmptyState } from "../../../../components/ui/empty-state";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { PageSection } from "../../../../components/ui/page-section";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";
import { apiFetch } from "../../../../lib/api";

type ChangeEvent = {
  id: string;
  eventType: string;
  summary: string;
  actor: string | null;
  occurredAt: string;
  detailsJson?: Record<string, unknown> | null;
};

type DeploymentRow = {
  id: string;
  projectId: string | null;
  summary: string;
  deployedAt: string;
  version: string | null;
  commitSha: string | null;
  branch: string | null;
  resultingIncidentCount: number;
  resultingAlertCount: number;
};

export default function ProjectDeploymentsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, loading, error } = useProjectWorkspace(projectId);
  const [changeEvents, setChangeEvents] = useState<ChangeEvent[]>([]);
  const [deployments, setDeployments] = useState<DeploymentRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setDataLoading(true);
      setDataError(null);
      try {
        const [events, intelligence] = await Promise.all([
          apiFetch<ChangeEvent[]>(`/projects/${projectId}/change-events?take=40`),
          apiFetch<{ deployments: DeploymentRow[] }>("/intelligence?harvest=false").catch(() => ({
            deployments: [] as DeploymentRow[]
          }))
        ]);
        setChangeEvents(events ?? []);
        setDeployments((intelligence.deployments ?? []).filter((row) => row.projectId === projectId));
      } catch (err: unknown) {
        setDataError(err instanceof Error ? err.message : "Failed to load deployments");
      } finally {
        setDataLoading(false);
      }
    };
    if (projectId) void load();
  }, [projectId]);

  const deployLikeEvents = changeEvents.filter((row) =>
    /deploy|release|rollback/i.test(`${row.eventType} ${row.summary}`)
  );

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title="Deployments"
      subtitle="Change events and deployment correlation from recorded operational data."
      project={project}
      loading={loading}
      error={error}
    >
      {dataError ? <section className="panel error-panel">{dataError}</section> : null}

      <PageSection title="Deploy-related change events" description="Sourced from /change-events for this application.">
        {dataLoading ? <p>Loading change events…</p> : null}
        {!dataLoading && deployLikeEvents.length === 0 ? (
          <EmptyState
            title="No deployment events recorded"
            description="Deploy webhooks and change events will appear here when ingested."
          />
        ) : (
          <div className="activity-feed">
            {deployLikeEvents.map((row) => (
              <article className="activity-feed-item" key={row.id}>
                <div className="activity-feed-head">
                  <span className="meta-chip">{row.eventType}</span>
                  {row.actor ? <StatusBadge label={row.actor} tone="neutral" /> : null}
                </div>
                <div className="activity-feed-title">{row.summary}</div>
                <p className="activity-feed-meta">{new Date(row.occurredAt).toLocaleString()}</p>
              </article>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection
        title="Calculated deployment correlation"
        description="Application deployment records with alerts/incidents observed in the configured time window. Correlation is not causation."
      >
        {deployments.length === 0 ? (
          <EmptyState title="No deployment intelligence yet" description="Records populate from change events via the intelligence foundation." />
        ) : (
          <div className="activity-feed">
            {deployments.slice(0, 15).map((row) => (
              <article className="activity-feed-item" key={row.id}>
                <div className="activity-feed-title">{row.summary}</div>
                <p className="activity-feed-meta">
                  {new Date(row.deployedAt).toLocaleString()}
                  {row.version ? ` · ${row.version}` : ""}
                  {row.commitSha ? ` · ${row.commitSha.slice(0, 7)}` : ""}
                </p>
                <p className="activity-feed-meta">
                  {row.resultingIncidentCount} incident(s) · {row.resultingAlertCount} alert(s) in correlation window
                </p>
              </article>
            ))}
          </div>
        )}
        <p>
          <Link className="text-link" href="/intelligence">
            Open Intelligence →
          </Link>
        </p>
      </PageSection>
    </ProjectWorkspaceShell>
  );
}
