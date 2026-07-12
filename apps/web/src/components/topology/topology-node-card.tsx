import type { TopologyNode } from "./topology-types";
import { healthLabel } from "./topology-types";
import { TopologySparkline } from "./topology-sparkline";
import { deriveNodeLiveMetrics, formatRequestsPerMin } from "./topology-metrics";
import { resolveInfraIcon } from "./topology-infra-icons";

type Props = {
  node: TopologyNode;
  displayStatus?: TopologyNode["status"];
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

export function TopologyNodeCard({
  node,
  displayStatus = node.status,
  childCount = 0,
  collapsed = false,
  onToggleCollapse
}: Props) {
  const metrics = deriveNodeLiveMetrics(node);
  const icon = resolveInfraIcon(node.name);
  const tone = toneFromStatus(displayStatus);

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
        {metrics.latencyMs != null ? <span className="topology-node-card-metric">{metrics.latencyMs}ms</span> : null}
        {metrics.requestsPerMin != null ? (
          <span className="topology-node-card-metric">{formatRequestsPerMin(metrics.requestsPerMin)}</span>
        ) : null}
      </div>

      <TopologySparkline seed={`${node.id}:${displayStatus}`} tone={tone} />

      <div className="topology-node-card-metrics-grid">
        {metrics.availabilityPercent != null ? (
          <span>{metrics.availabilityPercent.toFixed(2)}% avail</span>
        ) : (
          <span>— avail</span>
        )}
        {metrics.cpuPercent != null ? <span>CPU {metrics.cpuPercent}%</span> : null}
        {metrics.memoryPercent != null ? <span>Mem {metrics.memoryPercent}%</span> : null}
        {metrics.errorRatePercent != null ? <span>Err {metrics.errorRatePercent}%</span> : null}
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
