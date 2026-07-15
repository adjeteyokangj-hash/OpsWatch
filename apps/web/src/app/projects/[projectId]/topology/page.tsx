"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Shell } from "../../../../components/layout/shell";
import { Header } from "../../../../components/layout/header";
import { ProjectWorkspaceNav } from "../../../../components/projects/project-workspace-nav";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";
import { apiFetch } from "../../../../lib/api";
import { TopologyCanvas } from "../../../../components/topology/topology-canvas";
import { TopologyNodeDrawer } from "../../../../components/topology/topology-node-drawer";
import { TopologySummaryCards } from "../../../../components/topology/topology-summary-cards";
import { TopologyFilterBar, type TopologyViewMode } from "../../../../components/topology/topology-filter-bar";
import { TopologyListView } from "../../../../components/topology/topology-list-view";
import { TopologyTimeReplay } from "../../../../components/topology/topology-time-replay";
import { TopologyLiveOpsFeed } from "../../../../components/topology/topology-live-ops-feed";
import { TopologyApplicationPanel } from "../../../../components/topology/topology-application-panel";
import { TopologyRefreshBanner } from "../../../../components/topology/topology-error-banner";
import { EmptyState } from "../../../../components/ui/empty-state";
import { classifyTopologyError, type ClassifiedTopologyError } from "../../../../components/topology/topology-error-classify";
import type { ProjectTopologyResponse, TopologyHealthStatus, TopologyNodeType } from "../../../../components/topology/topology-types";

const REFRESH_MS = 15_000;

type MaintenanceBanner = {
  id: string;
  name: string;
  endsAt: string;
  suppressAlerts: boolean;
  suppressIncidents: boolean;
};

export default function ProjectTopologyPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, loading: projectLoading, error: projectError } = useProjectWorkspace(projectId);
  const [topology, setTopology] = useState<ProjectTopologyResponse | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ClassifiedTopologyError | null>(null);
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TopologyNodeType | "ALL">("ALL");
  const [healthFilter, setHealthFilter] = useState<TopologyHealthStatus | "ALL">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fitToken, setFitToken] = useState(0);
  const [viewMode, setViewMode] = useState<TopologyViewMode>("map");
  const [replayMinutesAgo, setReplayMinutesAgo] = useState(0);

  const load = useCallback(
    async (manual = false) => {
      if (!projectId) return;
      if (manual) setRefreshing(true);
      try {
        const [row, activeMaintenance] = await Promise.all([
          apiFetch<ProjectTopologyResponse>(`/projects/${projectId}/topology`),
          apiFetch<MaintenanceBanner[]>(`/maintenance-windows/active?projectId=${projectId}`)
        ]);
        setTopology(row);
        setMaintenance(activeMaintenance);
        setLastSuccessfulAt(row.generatedAt || new Date().toISOString());
        setError(null);
      } catch (err: unknown) {
        setError(classifyTopologyError(err));
      } finally {
        setLoading(false);
        if (manual) setRefreshing(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      void load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load, paused]);

  const selectedNode = topology?.nodes.find((row) => row.id === selectedNodeId) ?? null;
  const projectName = topology?.project.name ?? project?.name ?? "Project";

  const exportTopology = () => {
    if (!topology) return;
    const blob = new Blob([JSON.stringify(topology, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectName.toLowerCase().replace(/\s+/g, "-")}-topology.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (projectLoading && !topology) {
    return (
      <Shell>
        <Header title="Topology" />
        <section className="panel workspace-loading">
          <div className="loading-pulse" />
          <p>Loading service map…</p>
        </section>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="topology-page">
        <nav className="topology-breadcrumb" aria-label="Breadcrumb">
          <Link href="/projects">Projects</Link>
          <span aria-hidden="true">›</span>
          <Link href={`/projects/${projectId}`}>{projectName}</Link>
          <span aria-hidden="true">›</span>
          <span>Topology</span>
        </nav>

        <header className="topology-page-header">
          <div>
            <h1>Topology</h1>
            <p>Live view of your infrastructure, applications, workflows and services.</p>
            {topology ? (
              <p className="dashboard-subtle">
                Last updated {new Date(topology.generatedAt).toLocaleString()}
                {paused ? " · refresh paused while interacting" : ` · auto-refresh every ${REFRESH_MS / 1000}s`}
              </p>
            ) : null}
          </div>
          <div className="topology-page-actions">
            <button type="button" className="secondary-button" disabled={refreshing} onClick={() => void load(true)}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <button type="button" className="secondary-button" onClick={() => setFitToken((value) => value + 1)}>
              Fit to screen
            </button>
            <button type="button" className="primary-button" onClick={exportTopology} disabled={!topology}>
              Export
            </button>
          </div>
        </header>

        <section className="panel topology-nav-panel">
          <ProjectWorkspaceNav projectId={projectId} />
        </section>

        {projectError ? <section className="panel error-panel">{projectError}</section> : null}

        {maintenance.length > 0 ? (
          <section className="panel maintenance-banner">
            <strong>Maintenance active</strong>
            <ul>
              {maintenance.map((window) => (
                <li key={window.id}>
                  {window.name} until {new Date(window.endsAt).toLocaleString()}
                </li>
              ))}
            </ul>
            <Link href="/settings/maintenance">Manage windows</Link>
          </section>
        ) : null}

        {loading && !topology ? (
          <section className="panel workspace-loading">
            <div className="loading-pulse" />
            <p>Loading topology data…</p>
          </section>
        ) : null}

        {!loading && !topology && !error ? (
          <section className="panel">
            <EmptyState
              title="No topology data"
              description="Register services and dependencies to build the live service map."
              action={<Link className="primary-button" href={`/projects/${projectId}/components`}>Open components</Link>}
            />
          </section>
        ) : null}

        {topology && topology.nodes.length === 0 ? (
          <section className="panel">
            <EmptyState
              title="Topology is empty"
              description="This application has no monitored nodes yet. Add modules, workflows, or services to populate the map."
              action={<Link className="primary-button" href={`/projects/${projectId}/modules`}>Add modules</Link>}
            />
          </section>
        ) : null}

        {topology && topology.nodes.length > 0 ? (
          <>
            {error ? (
              <TopologyRefreshBanner
                error={error}
                lastSuccessfulAt={lastSuccessfulAt ?? topology.generatedAt ?? null}
                autoRetrying={!paused}
                onRetry={() => void load(true)}
              />
            ) : null}
            {viewMode === "list" ? <TopologySummaryCards topology={topology} /> : null}
            <TopologyFilterBar
              typeFilter={typeFilter}
              healthFilter={healthFilter}
              searchQuery={searchQuery}
              viewMode={viewMode}
              onTypeFilterChange={setTypeFilter}
              onHealthFilterChange={setHealthFilter}
              onSearchQueryChange={setSearchQuery}
              onViewModeChange={setViewMode}
            />
            <TopologyTimeReplay minutesAgo={replayMinutesAgo} onChange={setReplayMinutesAgo} />
            <div className="topology-workspace">
              {viewMode === "map" ? (
                <TopologyCanvas
                  topology={topology}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={setSelectedNodeId}
                  typeFilter={typeFilter}
                  healthFilter={healthFilter}
                  searchQuery={searchQuery}
                  fitToken={fitToken}
                  replayMinutesAgo={replayMinutesAgo}
                  traceFocus
                  onInteractingChange={setPaused}
                />
              ) : (
                <TopologyListView
                  topology={topology}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={setSelectedNodeId}
                  typeFilter={typeFilter}
                  healthFilter={healthFilter}
                  searchQuery={searchQuery}
                />
              )}
              <div className="topology-side-stack">
                <TopologyLiveOpsFeed
                  projectId={projectId}
                  topology={topology}
                  project={project}
                  selectedNode={selectedNode}
                  paused={paused}
                />
                {selectedNode ? (
                  <TopologyNodeDrawer
                    topology={topology}
                    node={selectedNode}
                    projectId={projectId}
                    project={project}
                    onClose={() => setSelectedNodeId(null)}
                  />
                ) : (
                  <TopologyApplicationPanel topology={topology} projectId={projectId} project={project} />
                )}
                <section className="panel topology-intel-slot">
                  <h3>Intelligence</h3>
                  <p className="dashboard-subtle">
                    Predictions stay disabled. Patterns and deploy correlation live on the Intelligence tab when evidence exists.
                  </p>
                  <Link className="text-link" href={`/projects/${projectId}/insights`}>
                    Open Intelligence →
                  </Link>
                </section>
              </div>
            </div>
          </>
        ) : null}

        {!topology && error ? (
          <TopologyRefreshBanner
            error={error}
            lastSuccessfulAt={lastSuccessfulAt}
            autoRetrying={!paused}
            onRetry={() => void load(true)}
          />
        ) : null}
      </div>
    </Shell>
  );
}
