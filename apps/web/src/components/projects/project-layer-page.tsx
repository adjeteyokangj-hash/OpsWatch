"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AddServiceForm } from "./add-service-form";
import { ProjectWorkspaceShell } from "./project-workspace-shell";
import { ServiceCardGrid } from "./service-card-grid";
import { ServiceList } from "./service-list";
import { WorkspaceSummaryStrip } from "./workspace-summary-strip";
import { PageSection } from "../ui/page-section";
import { EmptyState } from "../ui/empty-state";
import { useProjectWorkspace } from "../../hooks/use-project-workspace";
import { apiFetch } from "../../lib/api";

const componentTypes = new Set([
  "COMPONENT",
  "FRONTEND",
  "API",
  "DATABASE",
  "WORKER",
  "WEBHOOK",
  "EMAIL",
  "PAYMENT",
  "THIRD_PARTY"
]);

const serviceTypes = new Set(["API", "WEBHOOK", "EMAIL", "PAYMENT", "THIRD_PARTY", "FRONTEND"]);

const layers = {
  modules: {
    title: "Modules",
    subtitle: "Feature modules and bounded contexts within this application.",
    match: (type: string) => type === "MODULE",
    layout: "cards" as const
  },
  workflows: {
    title: "Workflows",
    subtitle: "End-to-end business flows and orchestration paths.",
    match: (type: string) => type === "WORKFLOW",
    layout: "cards" as const
  },
  components: {
    title: "Components & Services",
    subtitle: "Infrastructure, integrations, and supporting services.",
    match: (type: string) => componentTypes.has(type),
    layout: "table" as const
  }
} as const;

type LayerKey = keyof typeof layers;

type TopologyDiscoveryResult = {
  status: "SUCCEEDED" | "SKIPPED";
  moduleCount: number;
  hierarchyCount: number;
  summary: string;
};

const summarize = (rows: Array<any>) => {
  const healthy = rows.filter((row) => row.status === "HEALTHY").length;
  const degraded = rows.filter((row) => row.status === "DEGRADED").length;
  const critical = rows.filter((row) => row.status === "DOWN" || row.status === "CRITICAL").length;
  const unknown = rows.length - healthy - degraded - critical;
  return { total: rows.length, healthy, degraded, critical, unknown };
};

export function ProjectLayerPage({ layerKey }: { layerKey: LayerKey }) {
  const { projectId } = useParams<{ projectId: string }>();
  const config = layers[layerKey];
  const { project, loading, error, reload } = useProjectWorkspace(projectId);
  const services = (project?.services ?? []).filter((service: any) => config.match(service.type));
  const [componentTab, setComponentTab] = useState<"components" | "services">("components");
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [discoveryMessage, setDiscoveryMessage] = useState<string | null>(null);

  const apiConnection = (project?.Connection ?? []).find(
    (connection: any) => connection.mode === "API" && connection.installationStatus !== "ERROR"
  );

  const discoverStructure = async () => {
    if (!apiConnection?.id || discovering) return;
    setDiscovering(true);
    setDiscoveryError(null);
    setDiscoveryMessage(null);
    try {
      const result = await apiFetch<TopologyDiscoveryResult>(
        `/connections/${encodeURIComponent(apiConnection.id)}/discover-topology`,
        { method: "POST", body: JSON.stringify({}) }
      );
      setDiscoveryMessage(result.summary);
      await reload();
    } catch (discoverError) {
      setDiscoveryError(
        discoverError instanceof Error ? discoverError.message : "Application structure discovery failed"
      );
    } finally {
      setDiscovering(false);
    }
  };

  const filteredServices = useMemo(() => {
    if (layerKey !== "components") return services;
    return services.filter((service: any) =>
      componentTab === "services" ? serviceTypes.has(service.type) : !serviceTypes.has(service.type)
    );
  }, [componentTab, layerKey, services]);

  const summary = summarize(filteredServices);
  const pageTitle = layerKey === "components" ? "Components" : config.title;
  const canDiscoverModules = layerKey === "modules" && Boolean(apiConnection?.id);

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title={pageTitle}
      subtitle={config.subtitle}
      project={project}
      loading={loading}
      error={error}
      actions={
        <div className="page-header-actions">
          <AddServiceForm projectId={projectId} layerKey={layerKey} onCreated={() => void reload()} />
          {canDiscoverModules ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => void discoverStructure()}
              disabled={discovering}
            >
              {discovering ? "Discovering…" : "Discover structure"}
            </button>
          ) : null}
        </div>
      }
    >
      {loading ? (
        <section className="panel workspace-loading">
          <div className="loading-pulse" />
          <p>Loading {pageTitle.toLowerCase()}…</p>
        </section>
      ) : (
        <>
          <WorkspaceSummaryStrip
            cards={[
              { key: "total", label: "Total", value: summary.total, tone: "info" },
              { key: "healthy", label: "Healthy", value: summary.healthy, tone: "healthy" },
              { key: "degraded", label: "Warning", value: summary.degraded, tone: "degraded" },
              { key: "critical", label: "Critical", value: summary.critical, tone: "critical" },
              { key: "unknown", label: "Awaiting", value: summary.unknown, tone: "neutral" }
            ]}
          />
          <PageSection
            title={pageTitle}
            description={`${filteredServices.length} monitored ${pageTitle.toLowerCase()} in this application.`}
            className="workspace-section-card"
            persistKey={`project:${projectId}:layer:${layerKey}`}
          >
            {discoveryError ? <section className="error-panel" role="alert">{discoveryError}</section> : null}
            {discoveryMessage ? <section className="success-panel" role="status">{discoveryMessage}</section> : null}

            {layerKey === "components" ? (
              <div className="workspace-tab-bar" role="tablist" aria-label="Component views">
                <button
                  type="button"
                  role="tab"
                  className={componentTab === "components" ? "active" : undefined}
                  onClick={() => setComponentTab("components")}
                >
                  Components
                </button>
                <button
                  type="button"
                  role="tab"
                  className={componentTab === "services" ? "active" : undefined}
                  onClick={() => setComponentTab("services")}
                >
                  Services
                </button>
              </div>
            ) : null}

            {config.layout === "cards" ? (
              layerKey === "modules" && filteredServices.length === 0 && apiConnection ? (
                <EmptyState
                  title="No modules discovered yet"
                  description="The application connection is available, but its declared structure has not been imported. Discover structure to load the real module map supplied by the connected application."
                  action={
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void discoverStructure()}
                      disabled={discovering}
                    >
                      {discovering ? "Discovering application structure…" : "Discover application structure"}
                    </button>
                  }
                />
              ) : (
                <ServiceCardGrid
                  rows={filteredServices}
                  projectId={projectId}
                  onUpdated={() => void reload()}
                  primaryCta={
                    layerKey === "modules"
                      ? {
                          label: "View module →",
                          hrefFor: (serviceId) => `/projects/${projectId}/modules/${serviceId}`,
                          ariaLabelFor: (name) => `View module ${name}`
                        }
                      : undefined
                  }
                />
              )
            ) : (
              <ServiceList rows={filteredServices} projectId={projectId} onUpdated={() => void reload()} />
            )}
          </PageSection>
        </>
      )}
    </ProjectWorkspaceShell>
  );
}
