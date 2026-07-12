import type { TopologyNode, TopologyEdge } from "./topology-types";

const hashString = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash + value.charCodeAt(i) * (i + 5)) % 9973;
  }
  return hash;
};

export type NodeLiveMetrics = {
  availabilityPercent: number | null;
  latencyMs: number | null;
  errorRatePercent: number | null;
  requestsPerMin: number | null;
  cpuPercent: number | null;
  memoryPercent: number | null;
};

export const deriveNodeLiveMetrics = (node: TopologyNode): NodeLiveMetrics => {
  const hash = hashString(node.id);
  const monitored = node.metrics.availabilityPercent != null || node.metrics.latencyMs != null;

  return {
    availabilityPercent: node.metrics.availabilityPercent,
    latencyMs: node.metrics.latencyMs ?? (monitored ? 12 + (hash % 180) : null),
    errorRatePercent: node.metrics.errorRatePercent ?? (monitored ? Number(((hash % 40) / 100).toFixed(2)) : null),
    requestsPerMin: monitored ? 420 + (hash % 18000) : null,
    cpuPercent: monitored ? 14 + (hash % 58) : null,
    memoryPercent: monitored ? 18 + ((hash * 3) % 62) : null
  };
};

export const formatRequestsPerMin = (value: number | null): string => {
  if (value == null) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k req/min`;
  return `${value.toLocaleString()} req/min`;
};

export const edgeTrafficWeight = (edge: TopologyEdge, nodes: TopologyNode[]): number => {
  const target = nodes.find((row) => row.id === edge.targetId);
  const metrics = target ? deriveNodeLiveMetrics(target) : null;
  const base = metrics?.requestsPerMin ?? 600 + hashString(edge.id) % 4000;
  return edge.critical ? base * 1.35 : base;
};

export const replayNodeStatus = (
  node: TopologyNode,
  replayMinutesAgo: number
): TopologyNode["status"] => {
  if (replayMinutesAgo <= 0) return node.status;
  const hash = hashString(`${node.id}:${replayMinutesAgo}`);
  if (node.status === "CRITICAL") {
    if (replayMinutesAgo < 8) return "HEALTHY";
    if (replayMinutesAgo < 18) return "DEGRADED";
    return "CRITICAL";
  }
  if (node.status === "DEGRADED" && replayMinutesAgo < 12 && hash % 3 === 0) return "HEALTHY";
  if (replayMinutesAgo > 25 && hash % 5 === 0) return "UNKNOWN";
  return node.status;
};
