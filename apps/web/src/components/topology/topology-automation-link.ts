import type { ProjectIntegration } from "../../lib/integrations";
import { resolveConnectionState } from "../../lib/integrations";
import type { ProjectTopologyResponse } from "./topology-types";
import type { SelectedTopologyEdge } from "./topology-edge-style";

/** Integration types that can execute scoped remediation actions. */
export const REMEDIATION_PROVIDER_TYPES = [
  "WORKER_PROVIDER",
  "SERVICE_PROVIDER",
  "DEPLOYMENT_PROVIDER"
] as const;

export type ActiveAutomationRunSummary = {
  id: string;
  incidentId: string;
  status: string;
  affectedServiceIds: string[];
  targetServiceIds: string[];
};

/** True when a validated remediator integration is connected for the project. */
export const projectHasRemediationCapability = (
  integrations: ProjectIntegration[],
  projectId: string
): boolean =>
  integrations.some((row) => {
    if (row.projectId !== projectId) return false;
    const type = String(row.type || "").toUpperCase();
    if (!(REMEDIATION_PROVIDER_TYPES as readonly string[]).includes(type)) return false;
    return resolveConnectionState(row) === "connected";
  });

export const relatedIncidentsForEdge = (
  topology: ProjectTopologyResponse,
  edge: SelectedTopologyEdge
): Array<{ id: string; title: string; severity: string }> => {
  const rows = Object.entries(topology.nodeContext)
    .filter(([nodeId]) => nodeId === edge.sourceId || nodeId === edge.targetId)
    .flatMap(([, context]) => context.unresolvedIncidents);
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
};

export const relatedAlertsForEdge = (
  topology: ProjectTopologyResponse,
  edge: SelectedTopologyEdge
): Array<{ id: string; title: string; severity: string; status: string }> => {
  const rows = Object.entries(topology.nodeContext)
    .filter(([nodeId]) => nodeId === edge.sourceId || nodeId === edge.targetId)
    .flatMap(([, context]) => context.openAlerts);
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
};

/** Edge ids whose endpoints match an active remediating/verifying automation run. */
export const remediatingEdgeIdsFromRuns = (
  topology: ProjectTopologyResponse,
  runs: ActiveAutomationRunSummary[]
): Set<string> => {
  const serviceIds = new Set<string>();
  for (const run of runs) {
    for (const id of run.affectedServiceIds) {
      if (id) serviceIds.add(id);
    }
    for (const id of run.targetServiceIds) {
      if (id) serviceIds.add(id);
    }
  }
  const edgeIds = new Set<string>();
  if (serviceIds.size === 0) return edgeIds;
  for (const edge of topology.edges) {
    if (edge.type === "HIERARCHY") continue;
    if (serviceIds.has(edge.sourceId) || serviceIds.has(edge.targetId)) {
      edgeIds.add(edge.id);
    }
  }
  return edgeIds;
};

export const topologyReturnPath = (projectId: string, edgeId?: string | null): string => {
  const base = `/projects/${projectId}/topology`;
  if (!edgeId) return base;
  return `${base}?edgeId=${encodeURIComponent(edgeId)}`;
};
