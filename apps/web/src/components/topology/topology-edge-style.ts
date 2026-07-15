import type { TopologyEdge, TopologyHealthStatus, TopologyNode } from "./topology-types";
import { healthLabel } from "./topology-types";
import {
  moreNodeDisplayName,
  type VisualLayer
} from "./topology-visual-layers";

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

/** Written health for hierarchy lines — never "Unknown" (that reads as failed diagnosis). */
export const HIERARCHY_WRITTEN_HEALTH = "Not applicable (containment)";

export const HIERARCHY_STRUCTURE_NOTE =
  "OpsWatch diagnoses traffic health on dependency lines; this line shows structure only.";

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
  colourReason: string;
  /** Hierarchy-only: clarifies that traffic diagnosis lives on dependency edges. */
  structureNote?: string;
  /** Endpoint evidence lines (node health / discovery) — not edge traffic health. */
  endpointEvidence?: string[];
};

export type DescribeSelectedEdgeOptions = {
  moreNodes?: Array<{ id: string; layer: VisualLayer; hiddenCount: number }>;
  /**
   * Optional per-node connection notes (e.g. discovery pending).
   * Keys are node ids; values are short human-readable clauses.
   */
  endpointNotesById?: Map<string, string>;
};

export const colourReasonForEdge = (
  kind: LineStyleKind,
  status: TopologyHealthStatus
): string => {
  if (kind === "hierarchy") {
    return "Hierarchy/containment edges always render grey dashed — colour is not traffic health.";
  }
  if (status === "HEALTHY") {
    return "Selected because dependency target (or both endpoints) have healthy monitoring evidence and no linked failures.";
  }
  if (status === "DEGRADED") {
    return "Selected because an endpoint is degraded, a warn check exists, or a non-critical alert is linked.";
  }
  if (status === "CRITICAL") {
    return "Selected because a failed check or critical/high alert is linked to an endpoint of this relationship.";
  }
  return "Selected because there is no conclusive recent evidence for this dependency.";
};

export const resolveEndpointDisplayName = (
  nodeId: string,
  nodesById: Map<string, TopologyNode>,
  moreNodes?: DescribeSelectedEdgeOptions["moreNodes"]
): string => {
  const node = nodesById.get(nodeId);
  if (node) return node.name;
  const moreLabel = moreNodeDisplayName(nodeId, moreNodes);
  if (moreLabel) return moreLabel;
  return nodeId;
};

const endpointEvidenceLine = (
  role: "Source" | "Target",
  nodeId: string,
  nodesById: Map<string, TopologyNode>,
  options?: DescribeSelectedEdgeOptions
): string | null => {
  const moreLabel = moreNodeDisplayName(nodeId, options?.moreNodes);
  if (moreLabel) {
    return `${role}: ${moreLabel} (collapsed group — expand to inspect individual nodes)`;
  }
  const node = nodesById.get(nodeId);
  if (!node) return null;
  const note = options?.endpointNotesById?.get(nodeId);
  if (note) {
    return `${role} (${node.name}): ${note}`;
  }
  if (node.status === "UNKNOWN") {
    return `${role} (${node.name}): node health unknown — check monitoring / discovery on the node card`;
  }
  const alerts = node.risk.openAlerts;
  const alertBit = alerts > 0 ? ` · ${alerts} open alert${alerts === 1 ? "" : "s"}` : "";
  return `${role} (${node.name}): ${healthLabel(node.status)}${alertBit}`;
};

export const describeSelectedEdge = (
  edge: TopologyEdge,
  nodesById: Map<string, TopologyNode>,
  kind: LineStyleKind = edge.type === "HIERARCHY" ? "hierarchy" : "dependency",
  options?: DescribeSelectedEdgeOptions
): SelectedTopologyEdge => {
  const sourceName = resolveEndpointDisplayName(edge.sourceId, nodesById, options?.moreNodes);
  const targetName = resolveEndpointDisplayName(edge.targetId, nodesById, options?.moreNodes);
  const base: SelectedTopologyEdge = {
    id: edge.id,
    kind,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    sourceName,
    targetName,
    status: edge.status,
    critical: edge.critical,
    colourMeaning: colourMeaningForEdge(kind, edge.status),
    writtenHealth: kind === "hierarchy" ? HIERARCHY_WRITTEN_HEALTH : healthLabel(edge.status),
    colourReason: colourReasonForEdge(kind, edge.status)
  };

  if (kind !== "hierarchy") return base;

  const endpointEvidence = [
    endpointEvidenceLine("Source", edge.sourceId, nodesById, options),
    endpointEvidenceLine("Target", edge.targetId, nodesById, options)
  ].filter((row): row is string => Boolean(row));

  return {
    ...base,
    structureNote: HIERARCHY_STRUCTURE_NOTE,
    endpointEvidence: endpointEvidence.length > 0 ? endpointEvidence : undefined
  };
};

export const edgeTooltipLines = (edge: SelectedTopologyEdge): string => {
  const lines = [
    `${edge.sourceName} → ${edge.targetName}`,
    `Type: ${edge.kind === "hierarchy" ? "Hierarchy" : "Dependency"}`,
    `Health: ${edge.writtenHealth}`,
    edge.colourMeaning
  ];

  if (edge.kind === "hierarchy") {
    if (edge.structureNote) lines.push(edge.structureNote);
    for (const row of edge.endpointEvidence ?? []) {
      lines.push(row);
    }
  } else {
    lines.push("Discovery: declared", "Confidence: confirmed");
  }

  return lines.join("\n");
};
