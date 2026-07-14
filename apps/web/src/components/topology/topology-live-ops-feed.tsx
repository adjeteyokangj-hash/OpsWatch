"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../lib/api";
import type { ProjectTopologyResponse, TopologyNode } from "./topology-types";
import {
  buildFactualInsight,
  buildLiveOpsItems,
  type CheckListResponse,
  type LiveOpsItem,
  type LiveOpsKind,
  type ProjectSignalSource,
  type RemediationLogRow
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
  insight: "◆"
};

const kindLabel: Record<LiveOpsKind, string> = {
  alert: "Alert",
  incident: "Incident",
  heal: "Heal",
  check: "Check",
  heartbeat: "Heartbeat",
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
  const [incidentRootCauses, setIncidentRootCauses] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSignals = useCallback(async () => {
    try {
      const [remediationRows, checkRows, alertRows, incidentRows] = await Promise.all([
        apiFetch<RemediationLogRow[]>("/remediation/logs").catch(() => [] as RemediationLogRow[]),
        apiFetch<CheckListResponse>(`/checks?projectId=${projectId}`).catch(() => null),
        apiFetch<AlertApiRow[]>(`/alerts?projectId=${projectId}&onlyUnresolved=true`).catch(
          () => [] as AlertApiRow[]
        ),
        apiFetch<IncidentApiRow[]>(`/incidents?projectId=${projectId}&onlyUnresolved=true`).catch(
          () => [] as IncidentApiRow[]
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
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load operations feed");
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
      services: project?.services,
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
        selectedNode,
        projectId
      }),
    [topology, liveProject, logs, checks, selectedNode, projectId]
  );

  const insight = useMemo(
    () =>
      buildFactualInsight({
        topology,
        project: liveProject,
        checkSummary: checks?.summary ?? null
      }),
    [topology, liveProject, checks]
  );

  const selectedIncidents = selectedNode
    ? (topology.nodeContext[selectedNode.id]?.unresolvedIncidents ?? [])
    : [];
  const selectedHeals = selectedNode
    ? logs.filter((row) => row.serviceId === selectedNode.id).slice(0, 3)
    : [];

  return (
    <aside className="topology-live-ops panel" aria-label="Live operations feed" data-testid="topology-live-ops-feed">
      <header className="topology-live-ops-head">
        <div>
          <p className="topology-live-ops-eyebrow">OpsWatch intelligence</p>
          <h2>Live operations feed</h2>
        </div>
        <span className="topology-live-ops-pulse" aria-hidden="true" />
      </header>

      {insight ? (
        <p className="topology-live-ops-insight" data-testid="topology-live-ops-insight">
          {insight}
        </p>
      ) : null}

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

      <p className="topology-live-ops-predictive" data-testid="topology-predictive-placeholder">
        Predictive insights — coming online as signal history grows
      </p>

      {error ? <p className="dashboard-subtle topology-live-ops-error">{error}</p> : null}
      {loading && items.length === 0 ? <p className="dashboard-subtle">Loading live signals…</p> : null}

      {items.length === 0 && !loading ? (
        <p className="dashboard-subtle">No recent operational signals for this project yet.</p>
      ) : (
        <ul className="topology-live-ops-list">
          {items.map((item) => (
            <LiveOpsCard key={item.id} item={item} />
          ))}
        </ul>
      )}
    </aside>
  );
}

function LiveOpsCard({ item }: { item: LiveOpsItem }) {
  const body = (
    <>
      <div className="topology-live-ops-card-head">
        <span className={`topology-live-ops-icon tone-${item.tone}`} aria-hidden="true">
          {kindIcon[item.kind]}
        </span>
        <span className={`topology-live-ops-kind ${item.kind}`}>{kindLabel[item.kind]}</span>
      </div>
      <p className="topology-live-ops-title">{item.title}</p>
      <p className="topology-live-ops-detail">{item.detail}</p>
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
