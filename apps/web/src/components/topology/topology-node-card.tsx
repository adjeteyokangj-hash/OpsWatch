import type { TopologyNode } from "./topology-types";
import { healthLabel } from "./topology-types";
import { TopologySparkline } from "./topology-sparkline";
import { deriveNodeLiveMetrics } from "./topology-metrics";
import { resolveInfraIcon } from "./topology-infra-icons";
import { classifyVisualLayer } from "./topology-visual-layers";

type Props = {
  node: TopologyNode;
  displayStatus?: TopologyNode["status"];
  compact?: boolean;
  childCount?: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
};

const toneFromStatus = (status: TopologyNode["status"]): string => {
  if (status === "HEALTHY") return "healthy";
  if (status === "DEGRADED") return "degraded";
  if (status === "CRITICAL") return "critical";
  return "neutral";
};

const defaultGlyph = (node: TopologyNode): string => {
  if (node.type === "APP") return "▦";
  if (node.type === "MODULE") return "▣";
  if (node.type === "WORKFLOW") return "↻";
  if (classifyVisualLayer(node) === "INFRASTRUCTURE") return "⛭";
  if (classifyVisualLayer(node) === "EXTERNAL") return "↗";
  return "◎";
};

export function TopologyNodeCard({
  node,
  displayStatus = node.status,
  compact = true,
  childCount = 0,
  collapsed = false,
  onToggleCollapse
}: Props) {
  const metrics = deriveNodeLiveMetrics(node);
  const icon = resolveInfraIcon(node.name);
  const tone = toneFromStatus(displayStatus);
  const availability = metrics.availabilityPercent;

  if (compact) {
    return (
      <div className={`topology-node-card topology-node-card--compact topology-node-card--${tone}`} xmlns="http://www.w3.org/1999/xhtml">
        <div className="topology-node-card-compact-head">
          {icon ? (
            <span className="topology-node-card-icon" style={{ color: icon.color, background: icon.background }}>
              {icon.glyph}
            </span>
          ) : (
            <span className="topology-node-card-icon topology-node-card-icon--generic">{defaultGlyph(node)}</span>
          )}
          <strong className="topology-node-card-name">{node.name}</strong>
          <span className={`topology-node-card-dot topology-node-card-dot--${tone}`} aria-hidden="true" />
        </div>
        <TopologySparkline seed={`${node.id}:${displayStatus}`} tone={tone} />
        <div className="topology-node-card-compact-foot">
          <span className="topology-node-card-availability">
            {availability == null ? healthLabel(displayStatus) : `${availability.toFixed(2)}%`}
          </span>
          {metrics.latencyMs != null ? <span className="topology-node-card-metric">{metrics.latencyMs}ms</span> : null}
        </div>
        {childCount > 0 ? (
          <button
            type="button"
            className="topology-node-card-expand"
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse?.();
            }}
            data-action="local-ui"
          >
            {collapsed ? `▸ ${childCount} beneath` : `▾ ${childCount} beneath`}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`topology-node-card topology-node-card--${tone}`} xmlns="http://www.w3.org/1999/xhtml">
      <div className="topology-node-card-head">
        {icon ? (
          <span className="topology-node-card-icon" style={{ color: icon.color, background: icon.background }}>
            {icon.glyph}
          </span>
        ) : (
          <span className={`topology-node-card-dot topology-node-card-dot--${tone}`} aria-hidden="true" />
        )}
        <div className="topology-node-card-title-wrap">
          <span className="topology-node-card-type">{node.type}</span>
          <strong className="topology-node-card-name">{node.name}</strong>
        </div>
      </div>
      <div className="topology-node-card-status-row">
        <span className={`topology-node-card-health topology-node-card-health--${tone}`}>
          ● {healthLabel(displayStatus)}
        </span>
      </div>
      <TopologySparkline seed={`${node.id}:${displayStatus}`} tone={tone} />
    </div>
  );
}

export function TopologyMoreCard({ count, label }: { count: number; label: string }) {
  return (
    <div className="topology-node-card topology-more-card" xmlns="http://www.w3.org/1999/xhtml">
      <span className="topology-more-card-count">+{count}</span>
      <span className="topology-more-card-label">more {label}</span>
    </div>
  );
}
