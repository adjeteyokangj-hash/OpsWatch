export type HealthTone = "healthy" | "degraded" | "down" | "unknown" | "maintenance" | "paused";

export const healthTone = (status: string): HealthTone => {
  if (status === "HEALTHY") return "healthy";
  if (status === "DOWN") return "down";
  if (status === "UNKNOWN") return "unknown";
  if (status === "MAINTENANCE") return "maintenance";
  if (status === "PAUSED" || status === "RECOVERING") return "paused";
  return "degraded";
};

export const healthLabel = (status: string, displayLabel?: string | null): string => {
  if (displayLabel) return displayLabel;
  if (status === "UNKNOWN") return "Waiting for first heartbeat";
  if (status === "RECOVERING") return "Recovering";
  if (status === "MAINTENANCE") return "Maintenance";
  if (status === "PAUSED") return "Paused";
  return status.charAt(0) + status.slice(1).toLowerCase();
};

export const layerLabel = (layer: string): string => {
  if (layer === "APPLICATION") return "Application";
  if (layer === "MODULE") return "Module";
  if (layer === "WORKFLOW") return "Workflow";
  if (layer === "COMPONENT") return "Component";
  return layer;
};
