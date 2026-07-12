import Link from "next/link";
import type { ProjectTopologyResponse } from "./topology-types";
import { healthClassName, healthLabel } from "./topology-types";
import { TopologySparkline } from "./topology-sparkline";
import { deriveNodeLiveMetrics } from "./topology-metrics";

type Props = {
  topology: ProjectTopologyResponse;
  projectId: string;
  project?: {
    environment?: string;
    publicUrl?: string | null;
    appVersion?: string | null;
    incidents?: Array<{ id: string; title: string; severity: string; openedAt: string; status: string }>;
  } | null;
};

export function TopologyApplicationPanel({ topology, projectId, project }: Props) {
  const appNode = topology.nodes.find((row) => row.type === "APP") ?? topology.nodes[0];
  const metrics = appNode ? deriveNodeLiveMetrics(appNode) : null;
  const availability = appNode?.metrics.availabilityPercent ?? metrics?.availabilityPercent ?? null;

  const healthy = topology.summary.healthy;
  const warning = topology.summary.degraded;
  const critical = topology.summary.critical;
  const unknown = topology.summary.unknown;
  const total = topology.summary.total || 1;
  const donut = [
    { key: "healthy", value: healthy, color: "#22c55e" },
    { key: "warning", value: warning, color: "#f59e0b" },
    { key: "critical", value: critical, color: "#ef4444" },
    { key: "unknown", value: unknown, color: "#94a3b8" }
  ];

  let cursor = 0;
  const gradient = donut
    .filter((row) => row.value > 0)
    .map((row) => {
      const start = (cursor / total) * 100;
      cursor += row.value;
      const end = (cursor / total) * 100;
      return `${row.color} ${start}% ${end}%`;
    })
    .join(", ");

  const incidents =
    project?.incidents?.filter((row) => row.status !== "RESOLVED").slice(0, 4) ??
    topology.nodes
      .flatMap((node) =>
        (topology.nodeContext[node.id]?.unresolvedIncidents ?? []).map((incident) => ({
          ...incident,
          nodeName: node.name
        }))
      )
      .slice(0, 4);

  return (
    <aside className="topology-detail-panel topology-application-panel panel" aria-label="Application overview">
      <section className="topology-app-card">
        <div className="topology-app-card-head">
          <span className="topology-app-card-icon" aria-hidden="true">
            ▦
          </span>
          <div>
            <h2>{topology.project.name}</h2>
            <span className={`topology-detail-badge ${healthClassName(topology.project.status as any)}`}>
              {healthLabel(topology.project.status as any)}
            </span>
          </div>
        </div>

        <div className="topology-app-availability">
          <strong>{availability == null ? "—" : `${availability.toFixed(2)}%`}</strong>
          <span>Availability</span>
          {appNode ? <TopologySparkline seed={`app-panel:${appNode.id}`} tone="healthy" /> : null}
        </div>

        <dl className="topology-app-meta">
          <div>
            <dt>Environment</dt>
            <dd>{project?.environment ?? "—"}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{new Date(topology.generatedAt).toLocaleTimeString()}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{project?.appVersion ?? "—"}</dd>
          </div>
          <div>
            <dt>Monitored nodes</dt>
            <dd>{topology.summary.total}</dd>
          </div>
        </dl>
      </section>

      <section className="topology-detail-section">
        <h3>Health summary</h3>
        <div className="topology-health-donut-wrap">
          <div
            className="topology-health-donut"
            style={{ background: gradient ? `conic-gradient(${gradient})` : "#e2e8f0" }}
            aria-hidden="true"
          />
          <ul className="topology-health-donut-legend">
            <li><span className="dot healthy" /> {healthy} Healthy</li>
            <li><span className="dot degraded" /> {warning} Warning</li>
            <li><span className="dot critical" /> {critical} Critical</li>
            <li><span className="dot unknown" /> {unknown} Unknown</li>
          </ul>
        </div>
      </section>

      <section className="topology-detail-section">
        <div className="topology-detail-subheading">
          <h3>Recent incidents</h3>
          <Link href={`/incidents?projectId=${projectId}`}>View all</Link>
        </div>
        {incidents.length === 0 ? (
          <p className="dashboard-subtle">No open incidents for this application.</p>
        ) : (
          <ul className="topology-incident-list">
            {incidents.map((incident: any) => (
              <li key={incident.id}>
                <Link href={`/incidents/${incident.id}`}>{incident.title}</Link>
                <span className={`result-pill ${incident.severity === "CRITICAL" ? "fail" : "warn"}`}>
                  {incident.severity}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="field-hint topology-app-hint">Select any node on the map to inspect dependencies and quick actions.</p>
    </aside>
  );
}
