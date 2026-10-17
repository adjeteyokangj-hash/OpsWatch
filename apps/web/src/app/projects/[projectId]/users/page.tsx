"use client";

import { useParams } from "next/navigation";
import { ProjectUsersPanel } from "../../../../components/projects/project-users-panel";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";

export default function ProjectUsersPage() {
  const params = useParams<{ projectId: string }>();
  const { project, loading, error } = useProjectWorkspace(params.projectId);

  return (
    <ProjectWorkspaceShell
      projectId={params.projectId}
      title="Users"
      subtitle="Authorised NiiNai staff and their live sessions."
      project={project}
      loading={loading}
      error={error}
    >
      {project ? (
        <ProjectUsersPanel
          users={Array.isArray(project.monitoredUsers) ? project.monitoredUsers : []}
          persistKey={`project:${project.id}:users`}
        />
      ) : null}
    </ProjectWorkspaceShell>
  );
}
