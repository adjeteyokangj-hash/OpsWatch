import type { TopologyNode, TopologyEdge } from "./topology-types";

export type NodeLiveMetrics = {
  availabilityPercent: number | null;
  latencyMs: number | null;
  errorRatePercent: number | null;
  availabilityTrend: number[];
};

export const deriveNodeLiveMetrics = (node: TopologyNode): NodeLiveMetrics => ({
  availabilityPercent: node.metrics.availabilityPercent,
  latencyMs: node.metrics.latencyMs,
  errorRatePercent: node.metrics.errorRatePercent,
  availabilityTrend: node.metrics.availabilityTrend ?? []
});

export const edgeTrafficWeight = (edge: TopologyEdge, nodes: TopologyNode[]): number => {
  const target = nodes.find((row) => row.id === edge.targetId);
  const availability = target?.metrics.availabilityPercent;
  const base = availability != null ? Math.max(400, availability * 18) : 800;
  return edge.critical ? base * 1.25 : base;
};

export const replayNodeStatus = (
  node: TopologyNode,
  replayMinutesAgo: number
): TopologyNode["status"] => {
  if (replayMinutesAgo <= 0) return node.status;
  if (node.status === "CRITICAL" && replayMinutesAgo < 10) return "DEGRADED";
  if (node.status === "CRITICAL" && replayMinutesAgo < 20) return "HEALTHY";
  return node.status;
};
