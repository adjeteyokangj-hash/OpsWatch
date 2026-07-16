"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { EmptyState } from "../../../../components/ui/empty-state";
import { LearningStateBanner } from "../../../../components/ui/learning-state-banner";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";

export default function ProjectLogsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, loading, error } = useProjectWorkspace(projectId);

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title="Logs"
      subtitle="Log stream workspace."
      project={project}
      loading={loading}
      error={error}
    >
      <LearningStateBanner
        state="EMPTY"
        message="Centralized application log ingestion is not enabled for this release. Use check results, alerts, and incident timelines for operational evidence."
        action={
          <Link className="text-link" href={`/projects/${projectId}/checks`}>
            Open checks →
          </Link>
        }
      />
      <EmptyState
        title="No log streams connected"
        description="This tab is reserved for future log shipping integrations. OpsWatch will not invent log lines or error rates."
        action={
          <Link className="primary-button" href={`/integrations/${projectId}`}>
            Review integrations
          </Link>
        }
      />
    </ProjectWorkspaceShell>
  );
}
