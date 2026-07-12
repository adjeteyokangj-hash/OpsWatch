import type { ProjectTopologyResponse, TopologyNodeType } from "./topology-types";
import { TopologySparkline } from "./topology-sparkline";

const layerMeta: Record<TopologyNodeType, { label: string; icon: string }> = {
  APP: { label: "Apps", icon: "▦" },
  MODULE: { label: "Modules", icon: "▣" },
  WORKFLOW: { label: "Workflows", icon: "↻" },
  COMPONENT: { label: "Components", icon: "◎" }
};

const summarizeLayer = (nodes: ProjectTopologyResponse["nodes"], type: TopologyNodeType) => {
  const rows = nodes.filter((node) => node.type === type);
  const issues = rows.filter((node) => node.status !== "HEALTHY" && node.status !== "UNKNOWN").length;
  const degraded = rows.filter((node) => node.status === "DEGRADED").length;
  const critical = rows.filter((node) => node.status === "CRITICAL").length;
  const healthy = rows.filter((node) => node.status === "HEALTHY").length;

  let status = "All healthy";
  let tone = "healthy";
  if (critical > 0) {
    status = `${critical} critical`;
    tone = "critical";
  } else if (degraded > 0) {
    status = `${degraded} degraded`;
    tone = "degraded";
  } else if (issues > 0) {
    status = `${issues} issue${issues === 1 ? "" : "s"}`;
    tone = "warn";
  } else if (rows.length === 0) {
    status = "None configured";
    tone = "neutral";
  } else if (healthy < rows.length) {
    status = `${rows.length - healthy} awaiting`;
    tone = "neutral";
  }

  return { total: rows.length, status, tone };
};

export function TopologySummaryCards({ topology }: { topology: ProjectTopologyResponse }) {
  const monitored = topology.nodes.filter((node) => node.status !== "UNKNOWN");
  const overallPct =
    topology.nodes.length === 0
      ? 0
      : monitored.length === 0
        ? 0
        : Math.round((topology.summary.healthy / topology.nodes.length) * 1000) / 10;

  const appNode = topology.nodes.find((node) => node.type === "APP");
  const availability = appNode?.metrics.availabilityPercent ?? overallPct;

  const cards = [
    {
      key: "overall",
      icon: "◉",
      label: "Overall health",
      value: `${availability.toFixed(1)}%`,
      status: topology.summary.critical > 0 ? "Critical issues" : topology.summary.degraded > 0 ? "Degraded" : "Healthy",
      tone: topology.summary.critical > 0 ? "critical" : topology.summary.degraded > 0 ? "degraded" : "healthy"
    },
    ...(["APP", "MODULE", "WORKFLOW", "COMPONENT"] as TopologyNodeType[]).map((type) => {
      const summary = summarizeLayer(topology.nodes, type);
      return {
        key: type,
        icon: layerMeta[type].icon,
        label: layerMeta[type].label,
        value: String(summary.total),
        status: summary.status,
        tone: summary.tone
      };
    }),
    {
      key: "alerts",
      icon: "!",
      label: "Open alerts",
      value: String(topology.summary.openAlerts),
      status: topology.summary.openAlerts === 0 ? "No active alerts" : "Needs attention",
      tone: topology.summary.openAlerts > 0 ? "warn" : "healthy"
    }
  ];

  return (
    <section className="topology-kpi-grid">
      {cards.map((card) => (
        <article className={`topology-kpi-card tone-${card.tone}`} key={card.key}>
          <div className="topology-kpi-top">
            <span className="topology-kpi-icon" aria-hidden="true">
              {card.icon}
            </span>
            <span className="topology-kpi-label">{card.label}</span>
          </div>
          <strong className="topology-kpi-value">{card.value}</strong>
          <span className="topology-kpi-status">{card.status}</span>
          <TopologySparkline seed={card.key} tone={card.tone} />
        </article>
      ))}
    </section>
  );
}
