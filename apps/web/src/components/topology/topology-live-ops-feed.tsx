"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../lib/api";
import { PageSection } from "../ui/page-section";
import type { ProjectTopologyResponse, TopologyNode } from "./topology-types";
import {
  buildFactualInsight,
  buildLiveOpsItems,
  buildOpsInsights,
  deriveLearningProgression,
  formatTimelineClock,
  type ChangeEventRow,
  type CheckListResponse,
  type LiveOpsItem,
  type LiveOpsKind,
  type ProjectSignalSource,
  type RemediationLogRow,
  type ServiceDependencyRow
} from "./topology-live-ops-build";

type Props = {
  projectId: string;
  topology: ProjectTopologyResponse;
  project?: ProjectSignalSource | null;
  selectedNode: TopologyNode | null;
  paused?: boolean;
};

const POLL_MS = 15_000;

const kindIcon: Record<LiveOpsKind, string> = {
  alert: "!",
  incident: "◉",
  heal: "↺",
  check: "✓",
  heartbeat: "♥",
  deploy: "↑",
  dependency: "⤴",
  insight: "◆"
};

const kindLabel: Record<LiveOpsKind, string> = {
  alert: "Alert",
  incident: "Incident",
  heal: "Heal",
  check: "Check",
  heartbeat: "Heartbeat",
  deploy: "Deploy",
  dependency: "Dependency",
  insight: "Insight"
};

type AlertRow = NonNullable<ProjectSignalSource["alerts"]>[number];
type IncidentRow = NonNullable<ProjectSignalSource["incidents"]>[number];

type AlertApiRow = AlertRow & { service?: { id: string; name: string } | null };
type IncidentApiRow = IncidentRow & { serviceIds?: string[] };

export function TopologyLiveOpsFeed({ projectId, topology, project, selectedNode, paused = false }: Props) {
  const [logs, setLogs] = useState<RemediationLogRow[]>([]);
  const [checks, setChecks] = useState<CheckListResponse | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [changeEvents, setChangeEvents] = useState<ChangeEventRow[]>([]);
  const [dependencies, setDependencies] = useState<ServiceDependencyRow[]>([]);
  const [incidentRootCauses, setIncidentRootCauses] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const loadSignals = useCallback(async () => {
    try {
      const [remediationRows, checkRows, alertRows, incidentRows, changeRows, dependencyRows] =
        await Promise.all([
          apiFetch<RemediationLogRow[]>("/remediation/logs").catch(() => [] as RemediationLogRow[]),
          apiFetch<CheckListResponse>(`/checks?projectId=${projectId}`).catch(() => null),
          apiFetch<AlertApiRow[]>(`/alerts?projectId=${projectId}&onlyUnresolved=true`).catch(
            () => [] as AlertApiRow[]
          ),
          apiFetch<IncidentApiRow[]>(`/incidents?projectId=${projectId}&onlyUnresolved=true`).catch(
            () => [] as IncidentApiRow[]
          ),
          apiFetch<ChangeEventRow[]>(`/projects/${projectId}/change-events?take=40`).catch(
            () => [] as ChangeEventRow[]
          ),
          apiFetch<ServiceDependencyRow[]>(`/projects/${projectId}/service-dependencies`).catch(
            () => [] as ServiceDependencyRow[]
          )
        ]);
      setLogs(
        (remediationRows ?? []).filter((row) => !row.projectId || row.projectId === projectId).slice(0, 40)
      );
      setChecks(checkRows);
      setAlerts(
        (alertRows ?? []).map((row) => ({
          ...row,
          serviceId: row.serviceId ?? row.service?.id ?? null
        }))
      );
      setIncidents(incidentRows ?? []);
      setChangeEvents(changeRows ?? []);
      setDependencies(dependencyRows ?? []);
      setError(null);
      setNowMs(Date.now());
    } catch (err: any) {
      setError(err?.message || "Failed to load operations timeline");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadSignals();
  }, [loadSignals]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      void loadSignals();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadSignals, paused]);

  useEffect(() => {
    if (!selectedNode) {
      setIncidentRootCauses({});
      return;
    }
    const ctx = topology.nodeContext[selectedNode.id];
    const unresolved = ctx?.unresolvedIncidents ?? [];
    if (unresolved.length === 0) {
      setIncidentRootCauses({});
      return;
    }

    let cancelled = false;
    const loadRootCauses = async () => {
      const entries: Record<string, string> = {};
      await Promise.all(
        unresolved.slice(0, 2).map(async (incident) => {
          try {
            const detail = await apiFetch<{ id: string; rootCause?: string | null }>(`/incidents/${incident.id}`);
            if (detail.rootCause?.trim()) {
              entries[incident.id] = detail.rootCause.trim();
            }
          } catch {
            // Keep feed honest: skip missing/unauthorized RCA rather than inventing one.
          }
        })
      );
      if (!cancelled) setIncidentRootCauses(entries);
    };
    void loadRootCauses();
    return () => {
      cancelled = true;
    };
  }, [selectedNode, topology.nodeContext]);

  const liveProject = useMemo<ProjectSignalSource>(
    () => ({
      ...project,
      alerts: alerts.length > 0 ? alerts : project?.alerts,
      incidents: incidents.length > 0 ? incidents : project?.incidents,
      heartbeats: project?.heartbeats,
      events: project?.events,
      services: project?.services,
      createdAt: project?.createdAt,
      lastSignalAt: project?.lastSignalAt,
      lastCompletedCheckAt: project?.lastCompletedCheckAt
    }),
    [project, alerts, incidents]
  );

  const items = useMemo(
    () =>
      buildLiveOpsItems({
        topology,
        project: liveProject,
        remediationLogs: logs,
        checkResults: checks,
        changeEvents,
        dependencies,
        selectedNode,
        projectId,
        nowMs
      }),
    [topology, liveProject, logs, checks, changeEvents, dependencies, selectedNode, projectId, nowMs]
  );

  const statusInsight = useMemo(
    () =>
      buildFactualInsight({
        topology,
        project: liveProject,
        checkSummary: checks?.summary ?? null,
        nowMs
      }),
    [topology, liveProject, checks, nowMs]
  );

  const opsInsights = useMemo(
    () =>
      buildOpsInsights({
        remediationLogs: logs,
        changeEvents,
        projectEvents: liveProject.events,
        projectId,
        nowMs
      }),
    [logs, changeEvents, liveProject.events, projectId, nowMs]
  );

  const learning = useMemo(
    () =>
      deriveLearningProgression({
        project: liveProject,
        topology,
        dependencyCount: dependencies.length,
        checkResultCount: checks?.items.filter((row) => row.latestResult).length ?? 0,
        remediationCount: logs.length,
        changeEventCount: changeEvents.length,
        nowMs
      }),
    [liveProject, topology, dependencies.length, checks, logs.length, changeEvents.length, nowMs]
  );

  const selectedIncidents = selectedNode
    ? (topology.nodeContext[selectedNode.id]?.unresolvedIncidents ?? [])
    : [];
  const selectedHeals = selectedNode
    ? logs.filter((row) => row.serviceId === selectedNode.id).slice(0, 3)
    : [];

  return (
    <PageSection
      title="Operations Timeline"
      description="Persisted and current event history; this does not replay the topology graph."
      className="topology-live-ops"
      persistKey={`project:${projectId}:topology:live-ops`}
      aria-label="Operations timeline"
      data-testid="topology-live-ops-feed"
      actions={<span className="topology-live-ops-pulse" aria-hidden="true" />}
    >
      <p className="dashboard-subtle" data-testid="topology-timeline-truth-label">
        <strong>Live event history.</strong>{" "}
        {paused ? "Refresh is paused while you interact with the map." : "New operational facts refresh every 15 seconds."}
      </p>
      {opsInsights.length > 0 ? (
        <section className="topology-ops-insights" aria-label="Ops insights" data-testid="topology-ops-insights">
          <p className="topology-ops-insights-label">Ops Insights</p>
          <ul>
            {opsInsights.map((insight) => (
              <li key={insight.id}>
                <p className="topology-ops-insights-text">{insight.text}</p>
                <p className="topology-ops-insights-evidence">{insight.evidence}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : statusInsight ? (
        <p className="topology-live-ops-insight" data-testid="topology-live-ops-insight">
          {statusInsight}
        </p>
      ) : null}

      <section
        className="topology-learning-progression"
        aria-label="Learning progression"
        data-testid="topology-learning-progression"
      >
        <p className="topology-learning-progression-label">{learning.label}</p>
        <p className="topology-learning-progression-detail">{learning.detail}</p>
      </section>

      {selectedNode ? (
        <section className="topology-live-ops-node-context" aria-label={`Context for ${selectedNode.name}`}>
          <h3>{selectedNode.name}</h3>
          {selectedIncidents.length === 0 && selectedHeals.length === 0 ? (
            <p className="dashboard-subtle">No open incident or heal history attached to this node.</p>
          ) : (
            <ul className="topology-live-ops-context-list">
              {selectedIncidents.map((incident) => (
                <li key={incident.id}>
                  <Link href={`/incidents/${incident.id}`}>{incident.title}</Link>
                  {incidentRootCauses[incident.id] ? (
                    <p className="topology-live-ops-rca">RCA: {incidentRootCauses[incident.id]}</p>
                  ) : (
                    <p className="dashboard-subtle">No stored root cause yet.</p>
                  )}
                </li>
              ))}
              {selectedHeals.map((heal) => (
                <li key={heal.id}>
                  <span className="topology-live-ops-kind heal">Heal</span>{" "}
                  {heal.action.replace(/_/g, " ")} · {heal.status}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {error ? <p className="dashboard-subtle topology-live-ops-error">{error}</p> : null}
      {loading && items.length === 0 ? <p className="dashboard-subtle">Loading timeline signals…</p> : null}

      {items.length === 0 && !loading ? (
        <p className="dashboard-subtle">No recent operational facts for this project yet.</p>
      ) : (
        <ul className="topology-live-ops-list" data-testid="topology-operations-timeline">
          {items.map((item) => (
            <TimelineCard key={item.id} item={item} nowMs={nowMs} />
          ))}
        </ul>
      )}
    </PageSection>
  );
}

function TimelineCard({ item, nowMs }: { item: LiveOpsItem; nowMs: number }) {
  const body = (
    <>
      <div className="topology-timeline-row">
        <time className="topology-timeline-clock" dateTime={item.at}>
          {formatTimelineClock(item.at, nowMs)}
        </time>
        <span className={`topology-live-ops-icon tone-${item.tone}`} aria-hidden="true">
          {kindIcon[item.kind]}
        </span>
        <div className="topology-timeline-body">
          <div className="topology-live-ops-card-head">
            <span className={`topology-live-ops-kind ${item.kind}`}>{kindLabel[item.kind]}</span>
          </div>
          <p className="topology-live-ops-title">{item.title}</p>
          {item.subject ? <p className="topology-timeline-subject">{item.subject}</p> : null}
          <p className="topology-live-ops-detail">{item.detail}</p>
        </div>
      </div>
    </>
  );

  if (item.href) {
    return (
      <li className={`topology-live-ops-card tone-${item.tone}`}>
        <Link href={item.href} className="topology-live-ops-card-link">
          {body}
        </Link>
      </li>
    );
  }

  return <li className={`topology-live-ops-card tone-${item.tone}`}>{body}</li>;
}
