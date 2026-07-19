"use client";

import { useParams } from "next/navigation";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { ServiceList } from "../../../../components/projects/service-list";
import { PageSection } from "../../../../components/ui/page-section";
import { EmptyState } from "../../../../components/ui/empty-state";
import { ProductTruthStatus } from "../../../../components/ui/product-truth-status";
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
      <section className="panel">
        <ProductTruthStatus state="Foundation" />
        <p className="dashboard-subtle">
          Infrastructure, serverless, and network entities appear only when declared or discovered through
          canonical topology evidence. OpsWatch does not infer them from names.
        </p>
      </section>
      {loading ? (
        <section className="panel">Loading monitored areas…</section>
      ) : services.length === 0 ? (
        <section className="panel" data-testid="monitored-areas-empty">
          <EmptyState
            title="No monitored areas"
            description="Declare services and dependencies, connect verified OpenTelemetry topology evidence, or configure a supported connection to populate this view."
          />
        </section>
      ) : (
        layerOrder.map((layer) => {
          const rows = services.filter((service: any) => service.type === layer);
          if (rows.length === 0) return null;
          return (
            <PageSection
              key={layer}
              title={layerTitle[layer] ?? layer}
              description={layerDescription[layer] ?? ""}
              className="layer-section"
              persistKey={`project:${projectId}:monitored:${layer.toLowerCase()}`}
              actions={
                <span className="layer-count-badge">
                  {rows.length} area{rows.length === 1 ? "" : "s"}
                </span>
              }
            >
              <ServiceList rows={rows} projectId={projectId} />
            </PageSection>
          );
        })
      )}
    </ProjectWorkspaceShell>
  );
}
