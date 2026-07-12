"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";
import { TopologyCanvas } from "../topology/topology-canvas";
import { TopologyNodeDrawer } from "../topology/topology-node-drawer";
import type { ProjectTopologyResponse, TopologyOverlays } from "../topology/topology-types";
import { evidenceTypeLabel } from "../topology/topology-types";

export type IncidentCausalGraphResponse = {
  incident: {
    id: string;
    projectId: string;
    title: string;
    status: string;
    severity: string;
  };
  topology: ProjectTopologyResponse;
  overlay: {
    probableRootCauses: TopologyOverlays["rootCauses"];
    propagationEdges: TopologyOverlays["propagationEdges"];
    affectedNodeIds: string[];
    incidentNodeIds: string[];
    changeEvents: TopologyOverlays["changeEvents"];
    correlatedIncidents: TopologyOverlays["correlatedIncidents"];
  };
  explanation: {
    summary: string | null;
    confidence: number | null;
    evidence: Array<{
      type: "OBSERVED" | "INFERRED" | "AI_SUGGESTED";
      description: string;
      source: string | null;
    }>;
  };
  generatedAt: string;
};

type Props = {
  incidentId: string;
  projectId?: string;
};

export const IncidentGraphView = ({ incidentId, projectId }: Props) => {
  const [graph, setGraph] = useState<IncidentCausalGraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedRootRank, setSelectedRootRank] = useState<number | null>(null);
  const [subgraphOnly, setSubgraphOnly] = useState(true);
  const [showChangeEvents, setShowChangeEvents] = useState(true);
  const [showCorrelated, setShowCorrelated] = useState(true);
  const [paused, setPaused] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const row = await apiFetch<IncidentCausalGraphResponse>(`/incidents/${incidentId}/causal-graph`);
      setGraph(row);
      setSelectedRootRank(row.overlay.probableRootCauses?.[0]?.rank ?? null);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load causal graph");
      setGraph(null);
    } finally {
      setLoading(false);
    }
  }, [incidentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const overlays = useMemo<TopologyOverlays | undefined>(() => {
    if (!graph) return undefined;
    return {
      rootCauses: graph.overlay.probableRootCauses ?? [],
      propagationEdges: graph.overlay.propagationEdges ?? [],
      affectedNodeIds: graph.overlay.affectedNodeIds ?? [],
      incidentNodeIds: graph.overlay.incidentNodeIds ?? [],
      changeEvents: graph.overlay.changeEvents ?? [],
      correlatedIncidents: graph.overlay.correlatedIncidents ?? []
    };
  }, [graph]);

  const selectedRoot = graph?.overlay.probableRootCauses?.find((row) => row.rank === selectedRootRank) ?? null;
  const selectedNode = graph?.topology.nodes.find((row) => row.id === selectedNodeId) ?? null;

  if (loading && !graph) {
    return <section className="panel">Loading causal graph…</section>;
  }

  if (error || !graph) {
    return <section className="panel error-panel">{error ?? "Causal graph unavailable."}</section>;
  }

  return (
    <>
      <section className="panel">
        <div className="topology-summary-head">
          <div>
            <h2>Incident graph</h2>
            <p className="dashboard-subtle">
              {graph.incident.severity} · {graph.incident.status} · generated{" "}
              {new Date(graph.generatedAt).toLocaleString()}
            </p>
          </div>
          <button type="button" className="btn ghost" onClick={() => void load()}>
            Refresh graph
          </button>
        </div>
        {graph.explanation.summary ? <p className="content">{graph.explanation.summary}</p> : null}
        {graph.explanation.confidence != null ? (
          <p className="dashboard-subtle">Overall confidence: {graph.explanation.confidence}%</p>
        ) : null}
      </section>

      <section className="panel topology-controls causal-graph-controls">
        <label>
          <input type="checkbox" checked={subgraphOnly} onChange={(e) => setSubgraphOnly(e.target.checked)} />
          Affected subgraph only
        </label>
        <label>
          <input type="checkbox" checked={showChangeEvents} onChange={(e) => setShowChangeEvents(e.target.checked)} />
          Change events
        </label>
        <label>
          <input type="checkbox" checked={showCorrelated} onChange={(e) => setShowCorrelated(e.target.checked)} />
          Cross-app correlation
        </label>
      </section>

      {(graph.overlay.probableRootCauses?.length ?? 0) > 0 ? (
        <section className="panel">
          <h3>Root-cause candidates</h3>
          <div className="pill-row">
            {(graph.overlay.probableRootCauses ?? []).map((row) => {
              const node = graph.topology.nodes.find((n) => n.id === row.nodeId);
              return (
                <button
                  key={row.rank}
                  type="button"
                  className={`pill${selectedRootRank === row.rank ? " active" : ""}`}
                  onClick={() => {
                    setSelectedRootRank(row.rank);
                    setSelectedNodeId(row.nodeId);
                  }}
                >
                  #{row.rank} {node?.name ?? row.nodeId}
                </button>
              );
            })}
          </div>
          {selectedRoot ? (
            <div className="causal-root-detail">
              <p>
                <strong>{evidenceTypeLabel(selectedRoot.evidenceType)}</strong>
                {selectedRoot.confidence != null ? ` · ${selectedRoot.confidence}% confidence` : null}
              </p>
              <p className="content">{selectedRoot.reason}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="topology-layout">
        <TopologyCanvas
          topology={graph.topology}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          typeFilter="ALL"
          healthFilter="ALL"
          onInteractingChange={setPaused}
          overlays={overlays}
          subgraphOnly={subgraphOnly}
          showChangeEvents={showChangeEvents}
          showCorrelatedIncidents={showCorrelated}
          dimUnrelated
        />
        {selectedNode ? (
          <aside className="topology-drawer-stack">
            <TopologyNodeDrawer
              topology={graph.topology}
              node={selectedNode}
              projectId={projectId ?? graph.incident.projectId}
              onClose={() => setSelectedNodeId(null)}
            />
            {(graph.overlay.affectedNodeIds ?? []).includes(selectedNode.id) ? (
              <section className="panel topology-drawer-section">
                <h3>Why affected</h3>
                <p className="content">
                  This node is in the incident impact set based on linked alerts, dependency propagation, or layer
                  impact analysis.
                </p>
                {(graph.overlay.propagationEdges ?? [])
                  .filter((edge) => edge.targetId === selectedNode.id || edge.sourceId === selectedNode.id)
                  .map((edge) => (
                    <p key={`${edge.order}-${edge.sourceId}`} className="dashboard-subtle">
                      Step {edge.order}: {edge.evidence[0]}
                    </p>
                  ))}
              </section>
            ) : null}
          </aside>
        ) : null}
      </div>

      <section className="panel">
        <h3>Evidence</h3>
        {graph.explanation.evidence.length === 0 ? (
          <p className="dashboard-subtle">No ranked evidence available yet.</p>
        ) : (
          <ul className="dashboard-list">
            {graph.explanation.evidence.map((row, index) => (
              <li key={`${row.source}-${index}`}>
                <strong>{evidenceTypeLabel(row.type)}</strong>
                <span className="dashboard-subtle">{row.source ? ` · ${row.source}` : ""}</span>
                <div>{row.description}</div>
              </li>
            ))}
          </ul>
        )}
        <p className="dashboard-subtle">
          Observed facts come from alerts, checks, and recorded events. Inferred and AI-suggested items are hypotheses,
          not confirmed root cause.
        </p>
        {paused ? <p className="dashboard-subtle">Graph interaction paused auto-refresh on the project topology page only.</p> : null}
        <Link className="btn ghost" href={`/projects/${graph.incident.projectId}/topology`}>
          Open full project topology
        </Link>
      </section>
    </>
  );
};
