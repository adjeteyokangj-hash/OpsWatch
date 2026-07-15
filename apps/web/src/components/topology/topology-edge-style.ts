import type { TopologyEdge, TopologyHealthStatus, TopologyNode } from "./topology-types";
import { healthLabel } from "./topology-types";

export type LineStyleKind = "dependency" | "hierarchy";

export type TopologyKeyEntry = {
  id: string;
  kind: "color" | "style";
  sampleClass: string;
  label: string;
  meaning: string;
};

/** Documented visual language — no undocumented colours. */
export const TOPOLOGY_KEY_ENTRIES: TopologyKeyEntry[] = [
  {
    id: "healthy",
    kind: "color",
    sampleClass: "topology-key-sample topology-key-sample--healthy",
    label: "Green solid",
    meaning: "Healthy active dependency or traffic relationship"
  },
  {
    id: "degraded",
    kind: "color",
    sampleClass: "topology-key-sample topology-key-sample--degraded",
    label: "Amber solid",
    meaning: "Degraded or slow dependency / traffic"
  },
  {
    id: "critical",
    kind: "color",
    sampleClass: "topology-key-sample topology-key-sample--critical",
    label: "Red solid",
    meaning: "Failing dependency or critical traffic failure"
  },
  {
    id: "unknown",
    kind: "color",
    sampleClass: "topology-key-sample topology-key-sample--unknown",
    label: "Grey solid",
    meaning: "Unknown health or insufficient recent evidence"
  },
  {
    id: "remediating",
    kind: "color",
    sampleClass: "topology-key-sample topology-key-sample--remediating",
    label: "Amber pulsing",
    meaning: "Automated repair running or recovery being verified"
  },
  {
    id: "hierarchy",
    kind: "style",
    sampleClass: "topology-key-sample topology-key-sample--hierarchy",
    label: "Grey dashed",
    meaning: "Hierarchy or containment (module → workflow → component)"
  },
  {
    id: "dependency",
    kind: "style",
    sampleClass: "topology-key-sample topology-key-sample--dependency",
    label: "Solid (health-coloured)",
    meaning: "Dependency or traffic relationship (colour = health)"
  }
];

/** Hierarchy edges always use documented grey — never parent-layer purple. */
export const HIERARCHY_EDGE_COLOR = "#94a3b8";

export const dependencyEdgeColorClass = (status: TopologyHealthStatus): string => {
  if (status === "HEALTHY") return "topology-health-healthy";
  if (status === "DEGRADED") return "topology-health-degraded";
  if (status === "CRITICAL") return "topology-health-critical";
  return "topology-health-unknown";
};

export const colourMeaningForEdge = (
  kind: LineStyleKind,
  status: TopologyHealthStatus
): string => {
  if (kind === "hierarchy") {
    return "Grey dashed — hierarchy or containment relationship (not traffic health).";
  }
  if (status === "HEALTHY") return "Green solid — healthy active dependency.";
  if (status === "DEGRADED") return "Amber solid — degraded or slow dependency.";
  if (status === "CRITICAL") return "Red solid — failing dependency.";
  return "Grey solid — unknown health or insufficient evidence.";
};

export type SelectedTopologyEdge = {
  id: string;
  kind: LineStyleKind;
  sourceId: string;
  targetId: string;
  sourceName: string;
  targetName: string;
  status: TopologyHealthStatus;
  critical: boolean;
  colourMeaning: string;
  writtenHealth: string;
};

export const describeSelectedEdge = (
  edge: TopologyEdge,
  nodesById: Map<string, TopologyNode>,
  kind: LineStyleKind = edge.type === "HIERARCHY" ? "hierarchy" : "dependency"
): SelectedTopologyEdge => {
  const source = nodesById.get(edge.sourceId);
  const target = nodesById.get(edge.targetId);
  return {
    id: edge.id,
    kind,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    sourceName: source?.name ?? edge.sourceId,
    targetName: target?.name ?? edge.targetId,
    status: edge.status,
    critical: edge.critical,
    colourMeaning: colourMeaningForEdge(kind, edge.status),
    writtenHealth: healthLabel(edge.status)
  };
};

export const edgeTooltipLines = (edge: SelectedTopologyEdge): string =>
  [
    `${edge.sourceName} → ${edge.targetName}`,
    `Type: ${edge.kind === "hierarchy" ? "Hierarchy" : "Dependency"}`,
    `Health: ${edge.writtenHealth}`,
    edge.colourMeaning,
    "Discovery: declared",
    "Confidence: confirmed"
  ].join("\n");
