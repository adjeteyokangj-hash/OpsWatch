"use client";

import { useParams } from "next/navigation";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { ServiceList } from "../../../../components/projects/service-list";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";

const layerTitle: Record<string, string> = {
  APP: "App Health",
  MODULE: "Modules",
  WORKFLOW: "Workflows",
  COMPONENT: "Components & Services"
};

const layerDescription: Record<string, string> = {
  APP: "Top-level application health and availability.",
  MODULE: "Feature modules and bounded contexts within this application.",
  WORKFLOW: "End-to-end business flows and orchestration paths.",
  COMPONENT: "Infrastructure, integrations, and supporting services."
};

const layerOrder = ["APP", "MODULE", "WORKFLOW", "COMPONENT"];

export default function MonitoredAreasPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, loading, error } = useProjectWorkspace(projectId);
  const services = project?.services ?? [];

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title="Monitored Areas"
      subtitle="Layered health across app, modules, workflows, and components."
      project={project}
      loading={loading}
      error={error}
    >
      {loading ? (
        <section className="panel">Loading monitored areas…</section>
      ) : (
        layerOrder.map((layer) => {
          const rows = services.filter((service: any) => service.type === layer);
          if (rows.length === 0) return null;
          return (
            <section className="panel layer-section" key={layer}>
              <div className="section-head">
                <div>
                  <h2>{layerTitle[layer]}</h2>
                  <p className="dashboard-subtle">{layerDescription[layer]}</p>
                </div>
                <span className="layer-count-badge">{rows.length} area{rows.length === 1 ? "" : "s"}</span>
              </div>
              <ServiceList rows={rows} projectId={projectId} />
            </section>
          );
        })
      )}
    </ProjectWorkspaceShell>
  );
}
