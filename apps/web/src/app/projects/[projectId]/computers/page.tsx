"use client";

import { useParams } from "next/navigation";
import { ProjectComputersPanel } from "../../../../components/projects/project-computers-panel";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";

const cloudFromProject = (project: any) => {
  const services = Array.isArray(project?.services) ? project.services : [];
  const cloud = services.find((service: any) => service?.name === "NiiNai Cloud");
  if (!cloud) return null;
  const status = String(cloud.healthDisplayLabel ? cloud.status : cloud.status ?? "UNKNOWN");
  return {
    status,
    label: String(cloud.healthDisplayLabel ?? cloud.status ?? "Waiting")
  };
};

export default function ProjectComputersPage() {
  const params = useParams<{ projectId: string }>();
  const { project, loading, error } = useProjectWorkspace(params.projectId);

  return (
    <ProjectWorkspaceShell
      projectId={params.projectId}
      title="Computers"
      subtitle="Installed NiiNai applications, reported independently."
      project={project}
      loading={loading}
      error={error}
    >
      {project ? (
        <ProjectComputersPanel
          projectId={project.id}
          devices={Array.isArray(project.monitoredDevices) ? project.monitoredDevices : []}
          cloud={cloudFromProject(project)}
          persistKey={`project:${project.id}:computers`}
        />
      ) : null}
    </ProjectWorkspaceShell>
  );
}
