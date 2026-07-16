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

const WORKER_ACTIONS = [
  "restart_sync_worker",
  "restart_outbox_processor",
  "retry_failed_jobs",
  "retry_outbox_item"
] as const;

/**
 * True when a remediator integration is connected + validated and supports the needed action.
 * Monitoring-only integrations never qualify.
 */
/** Connected + validated remediator on the project (may still lack a specific action capability). */
export const projectHasConnectedRemediator = (
  integrations: ProjectIntegration[],
  projectId: string
): boolean =>
  integrations.some((row) => {
    if (row.projectId !== projectId) return false;
    if (!row.enabled) return false;
    const type = String(row.type || "").toUpperCase();
    if (!(REMEDIATION_PROVIDER_TYPES as readonly string[]).includes(type)) return false;
    if (resolveConnectionState(row) !== "connected") return false;
    return row.validationStatus === "VALID";
  });

/** True when any project remediator has emergency disable engaged. */
export const remediatorEmergencyDisabled = (
  integrations: ProjectIntegration[],
  projectId: string
): boolean =>
  integrations.some((row) => {
    if (row.projectId !== projectId) return false;
    if (!row.enabled) return false;
    const type = String(row.type || "").toUpperCase();
    if (!(REMEDIATION_PROVIDER_TYPES as readonly string[]).includes(type)) return false;
    const config = row.configJson ?? {};
    return config.REMEDIATOR_EMERGENCY_DISABLED === true || config.REMEDIATOR_EMERGENCY_DISABLED === "true";
  });

export type RemediationPolicyGate = {
  globalEnabled: boolean;
  projectEnabled: boolean;
};

/** Org + project auto-run gates must allow execution before suggesting mode change. */
export const remediationPolicyAllowsExecution = (
  gate: RemediationPolicyGate | null | undefined
): boolean => {
  if (!gate) return true;
  return gate.globalEnabled && gate.projectEnabled;
};

export const projectHasRemediationCapability = (
  integrations: ProjectIntegration[],
  projectId: string,
  requiredAction: string = "restart_sync_worker"
): boolean =>
  integrations.some((row) => {
    if (row.projectId !== projectId) return false;
    if (!row.enabled) return false;
    const type = String(row.type || "").toUpperCase();
    if (!(REMEDIATION_PROVIDER_TYPES as readonly string[]).includes(type)) return false;
    if (resolveConnectionState(row) !== "connected") return false;
    if (row.validationStatus !== "VALID") return false;

    const config = row.configJson ?? {};
    const url =
      (typeof config.WORKER_RESTART_WEBHOOK_URL === "string" && config.WORKER_RESTART_WEBHOOK_URL) ||
      (typeof config.SERVICE_RESTART_WEBHOOK_URL === "string" && config.SERVICE_RESTART_WEBHOOK_URL) ||
      (typeof config.DEPLOYMENT_ROLLBACK_WEBHOOK_URL === "string" &&
        config.DEPLOYMENT_ROLLBACK_WEBHOOK_URL) ||
      "";
    if (!String(url).trim()) return false;
    if (config.REMEDIATOR_EMERGENCY_DISABLED === true || config.REMEDIATOR_EMERGENCY_DISABLED === "true") {
      return false;
    }

    const capsRaw = config.REMEDIATOR_CAPABILITIES;
    let caps: string[] = [];
    if (Array.isArray(capsRaw)) {
      caps = capsRaw.map(String);
    } else if (typeof capsRaw === "string" && capsRaw.trim()) {
      caps = capsRaw.split(",").map((part) => part.trim()).filter(Boolean);
    } else if (type === "WORKER_PROVIDER") {
      caps = [...WORKER_ACTIONS];
    } else if (type === "SERVICE_PROVIDER") {
      caps = ["restart_service"];
    } else if (type === "DEPLOYMENT_PROVIDER") {
      caps = ["rollback_deployment"];
    }

    return caps.includes(requiredAction);
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

export const automationModeSettingsHref = (projectId: string): string =>
  `/projects/${projectId}/automation`;

export const topologyReturnPath = (projectId: string, edgeId?: string | null): string => {
  const base = `/projects/${projectId}/topology`;
  if (!edgeId) return base;
  return `${base}?edgeId=${encodeURIComponent(edgeId)}`;
};
