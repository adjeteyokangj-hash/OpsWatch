"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { EmptyState } from "../../../../components/ui/empty-state";
import { LearningStateBanner } from "../../../../components/ui/learning-state-banner";
import { ProductTruthStatus } from "../../../../components/ui/product-truth-status";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";

export default function ProjectLogsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, loading, error } = useProjectWorkspace(projectId);

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title="Logs"
      subtitle="Logs foundation — operational evidence only."
      project={project}
      loading={loading}
      error={error}
    >
      <section className="panel" data-testid="logs-foundation-state">
        <div className="panel-heading-row">
          <div>
            <h2>Logs foundation</h2>
            <p className="dashboard-subtle">
              OpenTelemetry log evidence can contribute to alerts and incident timelines. OpsWatch does not
              currently retain a searchable central log index or expose log search.
            </p>
          </div>
          <ProductTruthStatus state="Foundation" />
        </div>
      </section>
      <LearningStateBanner
        state="EMPTY"
        message="No searchable log storage is enabled. Use persisted check results, alerts, and incident timelines for operational evidence."
        action={
          <Link className="text-link" href={`/projects/${projectId}/checks`}>
            Open checks →
          </Link>
        }
      />
      <EmptyState
        title="Searchable logs unavailable"
        description="Phase 6 must add retained log storage, indexing, query APIs, access controls, and a verified connection before log lines or stream counts can appear."
        action={
          <Link className="primary-button" href={`/integrations/${projectId}`}>
            Review integrations
          </Link>
        }
      />
    </ProjectWorkspaceShell>
  );
}
