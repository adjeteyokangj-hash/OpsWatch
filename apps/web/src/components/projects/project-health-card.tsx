import Link from "next/link";
import { HealthBadge } from "../health/health-badge";

const metricTone = (title: string, value: string | number): string => {
  const label = String(title).toLowerCase();
  const text = String(value).toLowerCase();
  if (label.includes("alert") && Number(value) > 0) return "warn";
  if (label.includes("incident") && Number(value) > 0) return "danger";
  if (label.includes("status") || label.includes("health")) {
    if (text.includes("healthy")) return "healthy";
    if (text.includes("degraded") || text.includes("warn")) return "warn";
    if (text.includes("down") || text.includes("fail")) return "danger";
    if (text.includes("awaiting") || text.includes("unknown")) return "unknown";
  }
  return "neutral";
};

export function ProjectHealthCard({
  title,
  value,
  href
}: {
  title: string;
  value: string | number;
  href?: string;
}) {
  const tone = metricTone(title, value);
  const card = (
    <article className={`metric-card metric-card-${tone}`}>
      <span className="metric-card-label">{title}</span>
      <strong className="metric-card-value">{value}</strong>
      {href ? <span className="metric-card-foot">View details →</span> : null}
    </article>
  );

  if (href) {
    return (
      <Link href={href} className="metric-card-link">
        {card}
      </Link>
    );
  }

  return card;
}

export function ProjectSnapshotPanel({
  healthLabel,
  healthReason,
  liveRisk,
  latestSignalLabel,
  affectedModules,
  affectedWorkflows,
  affectedComponents
}: {
  healthLabel: string;
  healthReason?: string | null;
  liveRisk: string;
  latestSignalLabel: string;
  affectedModules?: string[];
  affectedWorkflows?: string[];
  affectedComponents?: string[];
}) {
  return (
    <section className="panel snapshot-panel">
      <div className="section-head">
        <div>
          <h2>Operational snapshot</h2>
          <p className="dashboard-subtle">Current health, risk, and signal context for this application.</p>
        </div>
        <HealthBadge status={healthLabel === "Awaiting first check" ? "UNKNOWN" : healthLabel.toUpperCase()} displayLabel={healthLabel} />
      </div>
      <div className="snapshot-grid">
        <div className="snapshot-item">
          <span className="snapshot-label">Status reason</span>
          <strong>{healthReason ?? "—"}</strong>
        </div>
        <div className="snapshot-item">
          <span className="snapshot-label">Live risk</span>
          <strong>{liveRisk}</strong>
        </div>
        <div className="snapshot-item">
          <span className="snapshot-label">Latest signal</span>
          <strong>{latestSignalLabel}</strong>
        </div>
        {(affectedModules?.length ?? 0) > 0 ? (
          <div className="snapshot-item snapshot-item-wide">
            <span className="snapshot-label">Affected modules</span>
            <strong>{affectedModules?.join(", ")}</strong>
          </div>
        ) : null}
        {(affectedWorkflows?.length ?? 0) > 0 ? (
          <div className="snapshot-item snapshot-item-wide">
            <span className="snapshot-label">Affected workflows</span>
            <strong>{affectedWorkflows?.join(", ")}</strong>
          </div>
        ) : null}
        {(affectedComponents?.length ?? 0) > 0 ? (
          <div className="snapshot-item snapshot-item-wide">
            <span className="snapshot-label">Affected components</span>
            <strong>{affectedComponents?.join(", ")}</strong>
          </div>
        ) : null}
      </div>
    </section>
  );
}
