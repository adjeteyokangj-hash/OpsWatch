import type { TopologyNode } from "./topology-types";
import { resolveInfraIcon } from "./topology-infra-icons";

export type VisualLayer = "APP" | "MODULE" | "WORKFLOW" | "SERVICE" | "INFRASTRUCTURE" | "EXTERNAL";

export const VISUAL_LAYER_ORDER: VisualLayer[] = [
  "APP",
  "MODULE",
  "WORKFLOW",
  "SERVICE",
  "INFRASTRUCTURE",
  "EXTERNAL"
];

const INFRA_PATTERN =
  /postgres|redis|rabbitmq|kafka|mysql|mongo|elastic|s3|bucket|nginx|docker|kubernetes|k8s|cache|queue|database|db\b|memcached|blob|storage/i;

const EXTERNAL_PATTERN =
  /api\b|paystack|stripe|sendgrid|twilio|maps|google|external|webhook|sms|email|mailgun|paypal|cloudflare|oauth|gateway/i;

export const classifyVisualLayer = (node: TopologyNode): VisualLayer => {
  if (node.type === "APP") return "APP";
  if (node.type === "MODULE") return "MODULE";
  if (node.type === "WORKFLOW") return "WORKFLOW";
  if (resolveInfraIcon(node.name) || INFRA_PATTERN.test(node.name)) return "INFRASTRUCTURE";
  if (EXTERNAL_PATTERN.test(node.name)) return "EXTERNAL";
  return "SERVICE";
};

export const visualLayerTitle = (layer: VisualLayer): string => {
  if (layer === "APP") return "Application";
  if (layer === "MODULE") return "Modules";
  if (layer === "WORKFLOW") return "Workflows";
  if (layer === "SERVICE") return "Services";
  if (layer === "INFRASTRUCTURE") return "Infrastructure";
  return "External";
};

export const visualLayerCountLabel = (layer: VisualLayer, count: number): string => {
  if (layer === "APP") return count === 1 ? "1 application" : `${count} applications`;
  if (layer === "MODULE") return count === 1 ? "1 module" : `${count} modules`;
  if (layer === "WORKFLOW") return count === 1 ? "1 workflow" : `${count} workflows`;
  if (layer === "SERVICE") return count === 1 ? "1 service" : `${count} services`;
  if (layer === "INFRASTRUCTURE") return count === 1 ? "1 resource" : `${count} resources`;
  return count === 1 ? "1 service" : `${count} services`;
};

export const visualLayerLabel = (layer: VisualLayer, count: number): string =>
  `${visualLayerTitle(layer)} (${visualLayerCountLabel(layer, count)})`;

/**
 * Hierarchy edges use a fixed documented grey (`HIERARCHY_EDGE_COLOR`).
 * This layer palette (including WORKFLOW purple #9F7AEA) is for node accents / sparklines only —
 * never for painted dependency or hierarchy relationship lines.
 */
export const layerEdgeColor = (layer: VisualLayer): string => {
  if (layer === "MODULE") return "#48BB78";
  if (layer === "WORKFLOW") return "#9F7AEA";
  if (layer === "SERVICE") return "#ED8936";
  if (layer === "INFRASTRUCTURE") return "#64748b";
  if (layer === "EXTERNAL") return "#d97706";
  return "#94a3b8";
};

export const moreNodeId = (layer: VisualLayer, row: number): string => `more:${layer}:${row}`;
