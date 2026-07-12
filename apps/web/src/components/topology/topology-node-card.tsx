import type { TopologyNode } from "./topology-types";
import { healthLabel } from "./topology-types";
import { TopologySparkline, layerSparkTone } from "./topology-sparkline";
import { deriveNodeLiveMetrics } from "./topology-metrics";
import { resolveInfraIcon } from "./topology-infra-icons";
import { classifyVisualLayer, type VisualLayer } from "./topology-visual-layers";

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

const defaultGlyph = (layer: VisualLayer): string => {
  if (layer === "MODULE") return "▣";
  if (layer === "WORKFLOW") return "↻";
  if (layer === "SERVICE") return "◎";
  if (layer === "INFRASTRUCTURE") return "⛭";
  if (layer === "EXTERNAL") return "↗";
  return "▦";
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
  const visualLayer = classifyVisualLayer(node);
  const layerTone = layerSparkTone(visualLayer);
  const statusTone = toneFromStatus(displayStatus);
  const availability = metrics.availabilityPercent;

  if (compact) {
    return (
      <div
        className={`topology-node-card topology-node-card--compact topology-node-card--layer-${visualLayer.toLowerCase()}`}
      >
        <div className="topology-node-card-compact-head">
          {icon ? (
            <span className="topology-node-card-icon" style={{ color: icon.color, background: icon.background }}>
              {icon.glyph}
            </span>
          ) : (
            <span className={`topology-node-card-icon topology-node-card-icon--${visualLayer.toLowerCase()}`}>
              {defaultGlyph(visualLayer)}
            </span>
          )}
          <strong className="topology-node-card-name">{node.name}</strong>
          <span className={`topology-node-card-dot topology-node-card-dot--${statusTone}`} aria-hidden="true" />
        </div>
        <div className="topology-node-card-compact-body">
          <TopologySparkline points={metrics.availabilityTrend} seed={`${node.id}:${displayStatus}`} tone={layerTone} />
          <span className="topology-node-card-availability">
            {availability == null ? "—" : `${availability.toFixed(2)}%`}
          </span>
        </div>
        {availability == null ? (
          <span className="topology-node-card-awaiting">{healthLabel(displayStatus)}</span>
        ) : null}
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
    <div className={`topology-node-card topology-node-card--${statusTone}`}>
      <div className="topology-node-card-head">
        <strong className="topology-node-card-name">{node.name}</strong>
      </div>
      <TopologySparkline points={metrics.availabilityTrend} seed={`${node.id}:${displayStatus}`} tone={layerTone} />
    </div>
  );
}

export function TopologyMoreCard({ count, label }: { count: number; label: string }) {
  return (
    <div className="topology-node-card topology-more-card">
      <span className="topology-more-card-count">+{count}</span>
      <span className="topology-more-card-label">more {label}</span>
    </div>
  );
}
