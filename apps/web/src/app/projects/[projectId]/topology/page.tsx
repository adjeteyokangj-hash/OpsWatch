"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Shell } from "../../../../components/layout/shell";
import { Header } from "../../../../components/layout/header";
import { ProjectWorkspaceNav } from "../../../../components/projects/project-workspace-nav";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";
import { apiFetch } from "../../../../lib/api";
import type { ProjectIntegration } from "../../../../lib/integrations";
import { TopologyCanvas } from "../../../../components/topology/topology-canvas";
import { TopologyNodeDrawer } from "../../../../components/topology/topology-node-drawer";
import { TopologySummaryCards } from "../../../../components/topology/topology-summary-cards";
import {
  TopologyFilterBar,
  type TopologyFreshnessFilter,
  type TopologyViewMode
} from "../../../../components/topology/topology-filter-bar";
import { TopologyListView } from "../../../../components/topology/topology-list-view";
import { TopologyTimeReplay } from "../../../../components/topology/topology-time-replay";
import { TopologyLiveOpsFeed } from "../../../../components/topology/topology-live-ops-feed";
import { TopologyApplicationPanel } from "../../../../components/topology/topology-application-panel";
import { TopologyRefreshBanner } from "../../../../components/topology/topology-error-banner";
import { EmptyState } from "../../../../components/ui/empty-state";
import { classifyTopologyError, type ClassifiedTopologyError } from "../../../../components/topology/topology-error-classify";
import type { ProjectTopologyResponse, TopologyHealthStatus, TopologyNodeType } from "../../../../components/topology/topology-types";
import {
  auditTopologyRelationships,
  buildNodeRelationshipDiagnostics,
  type ConnectionFilter
} from "../../../../components/topology/topology-relationship";
import { TopologyRelationshipSummary } from "../../../../components/topology/topology-relationship-summary";
import { TopologyKey } from "../../../../components/topology/topology-key";
import {
  TopologyRelationshipDrawer,
  evaluateRelationshipAutomation
} from "../../../../components/topology/topology-relationship-drawer";
import type { RelationshipIncidentMemorySignals } from "../../../../components/topology/topology-relationship-drawer";
import {
  type ActiveAutomationRunSummary,
  projectHasConnectedRemediator,
  projectHasRemediationCapability,
  remediationPolicyAllowsExecution,
  remediatorEmergencyDisabled,
  relatedIncidentsForEdge,
  remediatingEdgeIdsFromRuns,
  type RemediationPolicyGate
} from "../../../../components/topology/topology-automation-link";
import { patchProjectAutonomousMode } from "../../../../components/automation/autonomous-mode-control";
import { describeSelectedEdge, type SelectedTopologyEdge } from "../../../../components/topology/topology-edge-style";
import { resolveDependencyDisplayLinks, resolveHierarchyDisplayLinks } from "../../../../components/topology/topology-edge-resolve";
import { computeLayeredLayout } from "../../../../components/topology/topology-layout";
import { classifyVisualLayer } from "../../../../components/topology/topology-visual-layers";

const REFRESH_MS = 15_000;
const SIDE_STACK_COLLAPSED_KEY = "opswatch.topology-side-collapsed";

function readSideStackCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDE_STACK_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

type MaintenanceBanner = {
  id: string;
  name: string;
  endsAt: string;
  suppressAlerts: boolean;
  suppressIncidents: boolean;
};

type AutomationPlanResponse = {
  runId?: string;
  status?: string;
  permissions?: { canApprove?: boolean };
};

export default function ProjectTopologyPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const searchParams = useSearchParams();
  const { project, loading: projectLoading, error: projectError, reload: reloadProject } = useProjectWorkspace(projectId);
  const [topology, setTopology] = useState<ProjectTopologyResponse | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceBanner[]>([]);
  const [integrations, setIntegrations] = useState<ProjectIntegration[]>([]);
  const [activeRuns, setActiveRuns] = useState<ActiveAutomationRunSummary[]>([]);
  const [remediationPolicyGate, setRemediationPolicyGate] = useState<RemediationPolicyGate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ClassifiedTopologyError | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
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
  const [connectionFilter, setConnectionFilter] = useState<ConnectionFilter>("ALL");
  const [locationFilter, setLocationFilter] = useState("ALL");
  const [provenanceFilter, setProvenanceFilter] = useState("ALL");
  const [freshnessFilter, setFreshnessFilter] =
    useState<TopologyFreshnessFilter>("ALL");
  const [selectedEdge, setSelectedEdge] = useState<SelectedTopologyEdge | null>(null);
  const [cardsExpanded, setCardsExpanded] = useState<"none" | "selected" | "all">("selected");
  const [fixActing, setFixActing] = useState(false);
  const [restoredEdgeId, setRestoredEdgeId] = useState<string | null>(null);
  const [incidentMemorySignals, setIncidentMemorySignals] = useState<RelationshipIncidentMemorySignals | null>(null);
  const [incidentMemoryLoading, setIncidentMemoryLoading] = useState(false);
  const [sideStackCollapsed, setSideStackCollapsed] = useState(false);

  useEffect(() => {
    setSideStackCollapsed(readSideStackCollapsed());
  }, []);

  const toggleSideStack = useCallback(() => {
    setSideStackCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDE_STACK_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Ignore storage failures (private mode, quota, etc.).
      }
      return next;
    });
    // After the column animates, force the map to remeasure and stretch.
    window.setTimeout(() => setFitToken((value) => value + 1), 220);
  }, []);

  // Selecting a node or edge needs the drawer visible — expand the stack.
  useEffect(() => {
    if (selectedEdge || selectedNodeId) {
      setSideStackCollapsed(false);
    }
  }, [selectedEdge, selectedNodeId]);

  const relationshipDiagnostics = useMemo(
    () => (topology ? buildNodeRelationshipDiagnostics(topology) : []),
    [topology]
  );
  const canonicalFilterOptions = useMemo(() => {
    const locations = new Map<string, string>();
    const provenances = new Set<string>();
    for (const context of Object.values(topology?.nodeContext ?? {})) {
      if (context.canonical?.location) {
        locations.set(
          context.canonical.location.id,
          context.canonical.location.name
        );
      }
      if (context.canonical?.provenance) {
        provenances.add(context.canonical.provenance);
      }
    }
    return {
      locations: [...locations.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      provenances: [...provenances].sort()
    };
  }, [topology]);

  const hasRemediationCapability = useMemo(
    () => (projectId ? projectHasRemediationCapability(integrations, projectId) : false),
    [integrations, projectId]
  );

  const hasConnectedRemediator = useMemo(
    () => (projectId ? projectHasConnectedRemediator(integrations, projectId) : false),
    [integrations, projectId]
  );

  const emergencyDisabled = useMemo(
    () => (projectId ? remediatorEmergencyDisabled(integrations, projectId) : false),
    [integrations, projectId]
  );

  const policyAllowsModeChange = useMemo(
    () => remediationPolicyAllowsExecution(remediationPolicyGate),
    [remediationPolicyGate]
  );

  const remediatingEdgeIds = useMemo(
    () => (topology ? remediatingEdgeIdsFromRuns(topology, activeRuns) : new Set<string>()),
    [topology, activeRuns]
  );

  const activeRunForSelectedEdge = useMemo(() => {
    if (!selectedEdge || !topology) return null;
    const edgeIds = remediatingEdgeIdsFromRuns(topology, activeRuns);
    if (!edgeIds.has(selectedEdge.id)) return null;
    return (
      activeRuns.find((run) => {
        const ids = new Set([...run.affectedServiceIds, ...run.targetServiceIds]);
        return ids.has(selectedEdge.sourceId) || ids.has(selectedEdge.targetId);
      }) ?? null
    );
  }, [selectedEdge, topology, activeRuns]);

  const relationshipEvaluation = useMemo(() => {
    if (!selectedEdge) return null;
    return evaluateRelationshipAutomation({
      edge: selectedEdge,
      topology: topology ?? undefined,
      projectAutomationMode: project?.automationMode,
      hasRemediationCapability,
      hasConnectedRemediator,
      remediatorEmergencyDisabled: emergencyDisabled,
      policyAllowsModeChange,
      incidentMemory: incidentMemorySignals,
      activeRun: activeRunForSelectedEdge
    });
  }, [
    selectedEdge,
    topology,
    project?.automationMode,
    hasRemediationCapability,
    hasConnectedRemediator,
    emergencyDisabled,
    policyAllowsModeChange,
    activeRunForSelectedEdge,
    incidentMemorySignals
  ]);

  useEffect(() => {
    if (!projectId || !selectedEdge) {
      setIncidentMemorySignals(null);
      return;
    }

    if (selectedEdge.kind === "hierarchy") {
      setIncidentMemorySignals(null);
      return;
    }

    let cancelled = false;
    setIncidentMemoryLoading(true);
    setIncidentMemorySignals(null);

    apiFetch<RelationshipIncidentMemorySignals | null>(
      `/projects/${projectId}/topology/relationships/${encodeURIComponent(selectedEdge.id)}/incident-memory`
    )
      .then((signals) => {
        if (cancelled) return;
        setIncidentMemorySignals(signals);
      })
      .catch(() => {
        if (cancelled) return;
        setIncidentMemorySignals(null);
      })
      .finally(() => {
        if (cancelled) return;
        setIncidentMemoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, selectedEdge?.id, selectedEdge?.kind]);

  useEffect(() => {
    if (!selectedEdge) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedEdge(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedEdge]);

  useEffect(() => {
    if (!topology || process.env.NODE_ENV === "production") return;
    const layoutNodes = [
      ...topology.nodes.filter((node) => classifyVisualLayer(node) === "APP"),
      ...topology.nodes.filter((node) => classifyVisualLayer(node) !== "APP")
    ];
    const layout = computeLayeredLayout(layoutNodes);
    const hierarchy = resolveHierarchyDisplayLinks(topology.edges, topology.nodes, layout);
    const dependency = resolveDependencyDisplayLinks(topology.edges, layout);
    const rendered = new Set<string>([
      ...hierarchy.map((link) => link.key),
      ...dependency.map((link) => link.key)
    ]);
    const audit = auditTopologyRelationships({ topology, renderedEdgeKeys: rendered });
    const edgeDiagnostics = topology.edges.map((edge) => {
      const source = topology.nodes.find((node) => node.id === edge.sourceId);
      const target = topology.nodes.find((node) => node.id === edge.targetId);
      const relatedAlertCount =
        (topology.nodeContext[edge.sourceId]?.openAlerts.length ?? 0) +
        (topology.nodeContext[edge.targetId]?.openAlerts.length ?? 0);
      const finalColour =
        edge.type === "HIERARCHY"
          ? "grey-dashed"
          : edge.status === "HEALTHY"
            ? "green"
            : edge.status === "DEGRADED"
              ? "amber"
              : edge.status === "CRITICAL"
                ? "red"
                : "grey";
      return {
        relationshipId: edge.id,
        source: source?.name ?? edge.sourceId,
        target: target?.name ?? edge.targetId,
        rawHealth: edge.status,
        normalisedHealth: edge.status,
        relatedAlertCount,
        lastObserved: topology.nodeContext[edge.targetId]?.lastCheckAt ?? null,
        finalColour,
        reason:
          edge.type === "HIERARCHY"
            ? "Hierarchy/containment — documented grey dashed"
            : `Dependency evidence status=${edge.status}`
      };
    });
    // Development-only relationship completeness + colour diagnostic.
    console.info("[topology-relationship-audit]", {
      projectId: topology.project.id,
      zeroDegreeModules: audit.zeroDegreeModules,
      missingSourceNodeIds: audit.missingSourceNodeIds,
      missingTargetNodeIds: audit.missingTargetNodeIds,
      duplicateRelationshipKeys: audit.duplicateRelationshipKeys,
      selfReferencingRelationshipIds: audit.selfReferencingRelationshipIds,
      edgesAbsentFromRenderedGraph: audit.edgesAbsentFromRenderedGraph,
      diagnostics: relationshipDiagnostics.filter((row) => row.nodeType === "MODULE"),
      edgeDiagnostics
    });
  }, [topology, relationshipDiagnostics]);

  const load = useCallback(
    async (manual = false) => {
      if (!projectId) return;
      if (manual) setRefreshing(true);
      try {
        const [row, activeMaintenance, integrationRows, runRows, policyPayload] = await Promise.all([
          apiFetch<ProjectTopologyResponse>(`/projects/${projectId}/topology`),
          apiFetch<MaintenanceBanner[]>(`/maintenance-windows/active?projectId=${projectId}`),
          apiFetch<ProjectIntegration[]>(
            `/settings/integrations?projectId=${encodeURIComponent(projectId)}`
          ).catch(() => [] as ProjectIntegration[]),
          apiFetch<ActiveAutomationRunSummary[]>(
            `/automation/projects/${encodeURIComponent(projectId)}/active-runs`
          ).catch(() => [] as ActiveAutomationRunSummary[]),
          apiFetch<{ policies: Array<{ policyType: string; policyKey: string; enabled: boolean }> }>(
            "/remediation/policy"
          ).catch(() => null)
        ]);
        setTopology(row);
        setMaintenance(activeMaintenance);
        setIntegrations(integrationRows);
        setActiveRuns(runRows);
        if (policyPayload?.policies) {
          const globalEnabled =
            policyPayload.policies.find((p) => p.policyType === "GLOBAL" && p.policyKey === "")?.enabled ??
            false;
          const projectEnabled =
            policyPayload.policies.find((p) => p.policyType === "PROJECT" && p.policyKey === projectId)
              ?.enabled ?? false;
          setRemediationPolicyGate({ globalEnabled, projectEnabled });
        }
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

  // Deep-link restore after Connect provider → returnTo=?edgeId=
  useEffect(() => {
    if (!topology || restoredEdgeId) return;
    const edgeId = searchParams.get("edgeId");
    if (!edgeId) return;
    const edge = topology.edges.find((row) => row.id === edgeId);
    if (!edge) {
      setRestoredEdgeId(edgeId);
      return;
    }
    const nodeById = new Map(topology.nodes.map((node) => [node.id, node]));
    const kind = edge.type === "HIERARCHY" ? "hierarchy" : "dependency";
    setSelectedEdge(describeSelectedEdge(edge, nodeById, kind));
    setSelectedNodeId(null);
    setRestoredEdgeId(edgeId);
  }, [topology, searchParams, restoredEdgeId]);

  const enableAutonomousMode = useCallback(async () => {
    if (!projectId) return;
    setFixActing(true);
    setFixError(null);
    try {
      await patchProjectAutonomousMode(projectId, "AUTO_HEAL_SAFE");
      await reloadProject();
    } catch (err: unknown) {
      setFixError(err instanceof Error ? err.message : "Failed to enable auto-heal mode");
    } finally {
      setFixActing(false);
    }
  }, [projectId, reloadProject]);

  const runFixWithAutomation = useCallback(async () => {
    if (!selectedEdge || !topology || !projectId) return;
    const evaluation = evaluateRelationshipAutomation({
      edge: selectedEdge,
      topology,
      projectAutomationMode: project?.automationMode,
      hasRemediationCapability,
      hasConnectedRemediator,
      remediatorEmergencyDisabled: emergencyDisabled,
      policyAllowsModeChange,
      activeRun: activeRunForSelectedEdge
    });
    if (
      evaluation.buttonState === "setup_required" ||
      evaluation.buttonState === "no_automated_fix" ||
      evaluation.buttonState === "observe_blocked" ||
      evaluation.buttonState === "remediating"
    ) {
      return;
    }

    const incidents = relatedIncidentsForEdge(topology, selectedEdge);
    if (incidents.length === 0) {
      setFixError(
        "No related incident on this relationship. Open a linked alert and create an incident before requesting automated repair."
      );
      return;
    }

    const confirmed = window.confirm("Run approved automated repair");
    if (!confirmed) return;

    const incidentId = incidents[0]!.id;
    setFixActing(true);
    setFixError(null);
    try {
      const plan = await apiFetch<AutomationPlanResponse>(
        `/automation/incidents/${incidentId}/plan`,
        { method: "POST" }
      );
      if (evaluation.buttonState === "approval_required" && plan.runId) {
        if (plan.status !== "APPROVAL_PENDING") {
          await apiFetch(`/automation/runs/${plan.runId}/request-approval`, { method: "POST" }).catch(
            () => undefined
          );
        }
      } else if (
        evaluation.buttonState === "ready" &&
        plan.runId &&
        plan.permissions?.canApprove
      ) {
        await apiFetch(`/automation/runs/${plan.runId}/approve`, {
          method: "POST",
          body: JSON.stringify({
            approved: true,
            reason: "Approved from topology relationship drawer"
          })
        });
      }
      await load(true);
      window.location.assign(`/incidents/${incidentId}`);
    } catch (err: unknown) {
      setFixError(err instanceof Error ? err.message : "Failed to start automated repair");
    } finally {
      setFixActing(false);
    }
  }, [
    selectedEdge,
    topology,
    projectId,
    project?.automationMode,
    hasRemediationCapability,
    hasConnectedRemediator,
    emergencyDisabled,
    policyAllowsModeChange,
    activeRunForSelectedEdge,
    load
  ]);

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
            <p className="project-workspace-brand">OpsWatch</p>
            <h1 data-testid="page-heading">Topology</h1>
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
        {fixError ? (
          <section className="panel error-panel" role="alert" data-testid="topology-fix-error">
            {fixError}
          </section>
        ) : null}

        {process.env.NODE_ENV !== "production" && topology?.readerDiagnostic ? (
          <section
            className="panel"
            data-testid="topology-reader-diagnostic"
            style={{
              borderLeft: `4px solid ${
                topology.readerDiagnostic.reader === "CANONICAL" &&
                !topology.readerDiagnostic.fallbackUsed
                  ? "#16a34a"
                  : "#d97706"
              }`
            }}
          >
            <strong>Topology reader diagnostic (dev only)</strong>
            <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
              <li data-testid="diag-reader">
                Topology reader: {topology.readerDiagnostic.reader}
              </li>
              <li data-testid="diag-fallback">
                Fallback used: {topology.readerDiagnostic.fallbackUsed ? "yes" : "no"}
              </li>
              <li data-testid="diag-entities">
                Canonical entity count: {topology.readerDiagnostic.canonicalEntityCount}
              </li>
              <li data-testid="diag-relationships">
                Canonical relationship count: {topology.readerDiagnostic.canonicalRelationshipCount}
              </li>
              <li data-testid="diag-legacy-fallback">
                Legacy fallback count: {topology.readerDiagnostic.legacyFallbackCount}
              </li>
              <li data-testid="diag-unresolved">
                Unresolved canonical references: {topology.readerDiagnostic.unresolvedCanonicalReferences}
              </li>
            </ul>
            {topology.readerDiagnostic.details.length > 0 ? (
              <p className="dashboard-subtle" data-testid="diag-details" style={{ marginTop: "0.5rem" }}>
                {topology.readerDiagnostic.details.join(" · ")}
              </p>
            ) : null}
          </section>
        ) : null}

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
              action={
                <Link className="primary-button" href={`/projects/${projectId}/components`}>
                  Open components
                </Link>
              }
            />
          </section>
        ) : null}

        {topology && topology.nodes.length === 0 ? (
          <section className="panel">
            <EmptyState
              title="Topology is empty"
              description="This application has no monitored nodes yet. Add modules, workflows, or services to populate the map."
              action={
                <Link className="primary-button" href={`/projects/${projectId}/modules`}>
                  Add modules
                </Link>
              }
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
              connectionFilter={connectionFilter}
              locationFilter={locationFilter}
              provenanceFilter={provenanceFilter}
              freshnessFilter={freshnessFilter}
              locations={canonicalFilterOptions.locations}
              provenances={canonicalFilterOptions.provenances}
              searchQuery={searchQuery}
              viewMode={viewMode}
              onTypeFilterChange={setTypeFilter}
              onHealthFilterChange={setHealthFilter}
              onConnectionFilterChange={setConnectionFilter}
              onLocationFilterChange={setLocationFilter}
              onProvenanceFilterChange={setProvenanceFilter}
              onFreshnessFilterChange={setFreshnessFilter}
              onSearchQueryChange={setSearchQuery}
              onViewModeChange={setViewMode}
            />
            <TopologyRelationshipSummary topology={topology} diagnostics={relationshipDiagnostics} />
            <TopologyKey />
            <TopologyTimeReplay minutesAgo={replayMinutesAgo} onChange={setReplayMinutesAgo} />
            <div className={`topology-workspace${sideStackCollapsed ? " topology-workspace--side-collapsed" : ""}`}>
              {viewMode === "map" ? (
                <TopologyCanvas
                  topology={topology}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={(nodeId) => {
                    setSelectedNodeId(nodeId);
                    if (nodeId) setSelectedEdge(null);
                  }}
                  selectedEdgeId={selectedEdge?.id ?? null}
                  onSelectEdge={setSelectedEdge}
                  remediatingEdgeIds={remediatingEdgeIds}
                  typeFilter={typeFilter}
                  healthFilter={healthFilter}
                  connectionFilter={connectionFilter}
                  locationFilter={locationFilter}
                  provenanceFilter={provenanceFilter}
                  freshnessFilter={freshnessFilter}
                  searchQuery={searchQuery}
                  fitToken={fitToken}
                  replayMinutesAgo={replayMinutesAgo}
                  cardsExpanded={cardsExpanded}
                  onExpandAll={() => setCardsExpanded("all")}
                  onCollapseAll={() => {
                    setCardsExpanded("none");
                    setSelectedNodeId(null);
                  }}
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
                  locationFilter={locationFilter}
                  provenanceFilter={provenanceFilter}
                  freshnessFilter={freshnessFilter}
                  searchQuery={searchQuery}
                />
              )}
              <div className="topology-side-stack">
                <button
                  type="button"
                  className="topology-side-toggle"
                  aria-expanded={!sideStackCollapsed}
                  aria-label={sideStackCollapsed ? "Expand side panels" : "Collapse side panels"}
                  title={sideStackCollapsed ? "Expand side panels" : "Collapse side panels"}
                  onClick={toggleSideStack}
                >
                  <span aria-hidden="true">{sideStackCollapsed ? "«" : "»"}</span>
                  {sideStackCollapsed ? <span className="topology-side-toggle-label">Panels</span> : null}
                </button>
                {selectedEdge ? (
                  <TopologyRelationshipDrawer
                    edge={selectedEdge}
                    topology={topology}
                    projectId={projectId}
                    evaluation={relationshipEvaluation}
                    evaluating={incidentMemoryLoading}
                    acting={fixActing}
                    onClose={() => setSelectedEdge(null)}
                    onFixWithAutomation={() => {
                      void runFixWithAutomation();
                    }}
                    onEnableAutonomousMode={() => {
                      void enableAutonomousMode();
                    }}
                  />
                ) : (
                  <TopologyLiveOpsFeed
                    projectId={projectId}
                    topology={topology}
                    project={project}
                    selectedNode={selectedNode}
                    paused={paused}
                  />
                )}
                {!selectedEdge && selectedNode ? (
                  <TopologyNodeDrawer
                    topology={topology}
                    node={selectedNode}
                    projectId={projectId}
                    project={project}
                    onClose={() => setSelectedNodeId(null)}
                  />
                ) : null}
                {!selectedEdge && !selectedNode ? (
                  <TopologyApplicationPanel topology={topology} projectId={projectId} project={project} />
                ) : null}
                <section className="panel topology-intel-slot" id="incident-memory">
                  <h3>Incident memory</h3>
                  <p className="dashboard-subtle">
                    Relationship-level learning appears when you select an edge on the map. Predictions stay disabled;
                    patterns and deploy correlation live on the Intelligence tab when evidence exists.
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
