import Link from "next/link";
import { HealthBadge } from "../health/health-badge";

const layerIcon = (type: string): string => {
  if (type === "MODULE") return "▣";
  if (type === "WORKFLOW") return "↻";
  if (type === "API") return "⚡";
  if (type === "DATABASE") return "🗄";
  if (type === "WEBHOOK") return "🔗";
  if (type === "EMAIL") return "✉";
  if (type === "PAYMENT") return "£";
  return "◎";
};

const statusHint = (status: string): string => {
  if (status === "HEALTHY") return "Operating normally";
  if (status === "DEGRADED") return "Needs attention";
  if (status === "DOWN" || status === "CRITICAL") return "Action required";
  return "Waiting for first heartbeat";
};

export function ServiceCardGrid({ rows, projectId }: { rows: Array<any>; projectId: string }) {
  if (rows.length === 0) {
    return (
      <div className="workspace-empty-inline">
        <p>No items in this layer yet.</p>
        <p className="dashboard-subtle">Use <strong>Add service</strong> above to register the first one.</p>
      </div>
    );
  }

  return (
    <div className="service-card-grid">
      {rows.map((row) => (
        <article className="service-card" key={row.id}>
          <div className="service-card-top">
            <span className="service-card-icon" aria-hidden="true">
              {layerIcon(row.type)}
            </span>
            <HealthBadge status={row.status} />
          </div>
          <h3>{row.name}</h3>
          <p className="service-card-meta">
            <span>{row.type}</span>
            {row.isCritical ? <span className="criticality-tag">Critical</span> : null}
          </p>
          <p className="service-card-hint">{statusHint(row.status)}</p>
          <Link className="service-card-link" href={`/checks?projectId=${projectId}&serviceId=${row.id}`}>
            View details →
          </Link>
        </article>
      ))}
    </div>
  );
}
