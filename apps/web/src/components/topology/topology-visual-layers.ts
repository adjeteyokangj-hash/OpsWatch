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

export const visualLayerLabel = (layer: VisualLayer, count: number): string => {
  if (layer === "APP") return count === 1 ? "Application" : `Applications (${count})`;
  if (layer === "MODULE") return `Modules (${count} module${count === 1 ? "" : "s"})`;
  if (layer === "WORKFLOW") return `Workflows (${count} workflow${count === 1 ? "" : "s"})`;
  if (layer === "SERVICE") return `Services (${count} service${count === 1 ? "" : "s"})`;
  if (layer === "INFRASTRUCTURE") return `Infrastructure (${count} resource${count === 1 ? "" : "s"})`;
  return `External (${count} service${count === 1 ? "" : "s"})`;
};

export const layerEdgeColor = (layer: VisualLayer): string => {
  if (layer === "MODULE") return "#48BB78";
  if (layer === "WORKFLOW") return "#9F7AEA";
  if (layer === "SERVICE") return "#ED8936";
  if (layer === "INFRASTRUCTURE") return "#64748b";
  if (layer === "EXTERNAL") return "#d97706";
  return "#94a3b8";
};

export const moreNodeId = (layer: VisualLayer, row: number): string => `more:${layer}:${row}`;
