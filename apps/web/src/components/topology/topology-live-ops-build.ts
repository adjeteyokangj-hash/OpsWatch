import type { ProjectTopologyResponse, TopologyNode } from "./topology-types";

export type LiveOpsKind = "alert" | "incident" | "heal" | "check" | "heartbeat" | "insight";

export type LiveOpsItem = {
  id: string;
  kind: LiveOpsKind;
  title: string;
  detail: string;
  at: string;
  href?: string;
  serviceId?: string | null;
  tone: "critical" | "warn" | "ok" | "neutral";
};

export type RemediationLogRow = {
  id: string;
  projectId?: string | null;
  serviceId?: string | null;
  incidentId?: string | null;
  action: string;
  status: string;
  executionMode?: string | null;
  createdAt: string;
  executedAt?: string | null;
  resultJson?: { summary?: string } | null;
};

export type CheckListResponse = {
  items: Array<{
    id: string;
    name: string;
    isActive: boolean;
    service: { id: string; name: string; baseUrl?: string | null };
    latestResult: { status: string; responseTimeMs: number | null; checkedAt: string } | null;
  }>;
  summary: { total: number; pass: number; fail: number; warn: number; pending: number };
};

export type ProjectSignalSource = {
  alerts?: Array<{
    id: string;
    title: string;
    severity?: string;
    status: string;
    lastSeenAt: string;
    serviceId?: string | null;
  }>;
  incidents?: Array<{
    id: string;
    title: string;
    severity?: string;
    status: string;
    openedAt: string;
    rootCause?: string | null;
    serviceIds?: string[];
  }>;
  heartbeats?: Array<{ receivedAt: string; status?: string }>;
  services?: Array<{
    id: string;
    name: string;
    baseUrl?: string | null;
    Check?: Array<{ isActive: boolean; CheckResult?: unknown[] }>;
    checks?: Array<{ isActive: boolean; checkResults?: unknown[] }>;
  }>;
  lastSignalAt?: string | null;
  lastCompletedCheckAt?: string | null;
};

const relativeTime = (value: string | null | undefined, nowMs: number): string => {
  if (!value) return "—";
  const ageMs = nowMs - new Date(value).getTime();
  if (Number.isNaN(ageMs)) return "—";
  const ageMin = Math.floor(ageMs / 60000);
  if (ageMin < 2) return "just now";
  if (ageMin < 60) return `${ageMin} min ago`;
  const ageHours = Math.floor(ageMin / 60);
  if (ageHours < 24) return `${ageHours} h ago`;
  return `${Math.floor(ageHours / 24)} d ago`;
};

const healTitle = (action: string): string => {
  const cleaned = action.replace(/_/g, " ").toLowerCase();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

export const countChecksWithoutTargetUrl = (project: ProjectSignalSource | null | undefined): number => {
  const services = project?.services ?? [];
  let count = 0;
  for (const service of services) {
    const checks = service.checks ?? service.Check ?? [];
    const active = checks.some((check) => check.isActive !== false);
    if (!active) continue;
    if (!service.baseUrl || !String(service.baseUrl).trim()) {
      count += 1;
    }
  }
  return count;
};

export const buildFactualInsight = (input: {
  topology: ProjectTopologyResponse;
  project?: ProjectSignalSource | null;
  checkSummary?: CheckListResponse["summary"] | null;
  nowMs?: number;
}): string | null => {
  const nowMs = input.nowMs ?? Date.now();
  const openAlerts = input.topology.summary.openAlerts;
  const openIncidents = input.topology.summary.openIncidents;
  const awaiting = Object.values(input.topology.nodeContext).filter(
    (ctx) => ctx.monitoringState === "AWAITING_FIRST_CHECK"
  ).length;
  const pendingChecks = input.checkSummary?.pending ?? awaiting;
  const noTarget = countChecksWithoutTargetUrl(input.project);
  const heartbeatAt =
    input.project?.heartbeats?.[0]?.receivedAt ??
    input.project?.lastSignalAt ??
    input.project?.lastCompletedCheckAt ??
    null;

  if (noTarget > 0) {
    return `${noTarget} monitored service${noTarget === 1 ? "" : "s"} with no target URL`;
  }
  if (openAlerts > 0) {
    return `${openAlerts} open alert${openAlerts === 1 ? "" : "s"}`;
  }
  if (openIncidents > 0) {
    return `${openIncidents} open incident${openIncidents === 1 ? "" : "s"}`;
  }
  if (pendingChecks > 0) {
    return `${pendingChecks} check${pendingChecks === 1 ? "" : "s"} pending first result`;
  }
  if (heartbeatAt) {
    return `Last heartbeat ${relativeTime(heartbeatAt, nowMs)}`;
  }
  return null;
};

export const buildLiveOpsItems = (input: {
  topology: ProjectTopologyResponse;
  project?: ProjectSignalSource | null;
  remediationLogs?: RemediationLogRow[];
  checkResults?: CheckListResponse | null;
  selectedNode?: TopologyNode | null;
  projectId: string;
  nowMs?: number;
  limit?: number;
}): LiveOpsItem[] => {
  const nowMs = input.nowMs ?? Date.now();
  const limit = input.limit ?? 12;
  const selectedId = input.selectedNode?.id ?? null;
  const items: LiveOpsItem[] = [];

  const alerts = input.project?.alerts ?? [];
  for (const alert of alerts.slice(0, 8)) {
    items.push({
      id: `alert-${alert.id}`,
      kind: "alert",
      title: alert.title,
      detail: `${alert.severity ?? "ALERT"} · ${alert.status} · ${relativeTime(alert.lastSeenAt, nowMs)}`,
      at: alert.lastSeenAt,
      href: `/alerts/${alert.id}`,
      serviceId: alert.serviceId ?? null,
      tone: alert.severity === "CRITICAL" || alert.severity === "HIGH" ? "critical" : "warn"
    });
  }

  const incidents = input.project?.incidents ?? [];
  for (const incident of incidents.slice(0, 8)) {
    if (incident.status === "RESOLVED") continue;
    items.push({
      id: `incident-${incident.id}`,
      kind: "incident",
      title: incident.title,
      detail: `${incident.severity ?? "INCIDENT"} · ${incident.status} · opened ${relativeTime(incident.openedAt, nowMs)}`,
      at: incident.openedAt,
      href: `/incidents/${incident.id}`,
      serviceId: incident.serviceIds?.[0] ?? null,
      tone: incident.severity === "CRITICAL" ? "critical" : "warn"
    });
  }

  const projectLogs = (input.remediationLogs ?? []).filter(
    (row) => !row.projectId || row.projectId === input.projectId
  );
  for (const log of projectLogs.slice(0, 8)) {
    const when = log.executedAt ?? log.createdAt;
    const mode = log.executionMode ? ` · ${log.executionMode.toLowerCase()}` : "";
    items.push({
      id: `heal-${log.id}`,
      kind: "heal",
      title: healTitle(log.action),
      detail: `${log.status}${mode}${log.resultJson?.summary ? ` · ${log.resultJson.summary}` : ""} · ${relativeTime(when, nowMs)}`,
      at: when,
      href: log.incidentId ? `/incidents/${log.incidentId}` : `/projects/${input.projectId}/automation`,
      serviceId: log.serviceId ?? null,
      tone: log.status === "FAILED" || log.status === "BLOCKED" ? "critical" : log.status === "SUCCEEDED" || log.status === "EXECUTED" ? "ok" : "neutral"
    });
  }

  const checkItems = input.checkResults?.items ?? [];
  for (const check of checkItems.slice(0, 10)) {
    const latest = check.latestResult;
    if (!latest) continue;
    if (latest.status === "PASS" && items.length > 6) continue;
    const latency = latest.responseTimeMs != null ? ` · ${latest.responseTimeMs} ms` : "";
    items.push({
      id: `check-${check.id}-${latest.checkedAt}`,
      kind: "check",
      title: `${check.service.name}: ${check.name}`,
      detail: `${latest.status}${latency} · ${relativeTime(latest.checkedAt, nowMs)}`,
      at: latest.checkedAt,
      href: `/checks/${check.id}`,
      serviceId: check.service.id,
      tone: latest.status === "FAIL" ? "critical" : latest.status === "WARN" ? "warn" : "ok"
    });
  }

  // Fallback: node check status from topology when check list is empty
  if (checkItems.length === 0) {
    for (const node of input.topology.nodes) {
      const ctx = input.topology.nodeContext[node.id];
      if (!ctx?.lastCheckAt || !ctx.lastCheckStatus) continue;
      items.push({
        id: `topo-check-${node.id}-${ctx.lastCheckAt}`,
        kind: "check",
        title: `${node.name} check`,
        detail: `${ctx.lastCheckStatus} · ${relativeTime(ctx.lastCheckAt, nowMs)}`,
        at: ctx.lastCheckAt,
        href: `/checks?projectId=${input.projectId}&serviceId=${node.id}`,
        serviceId: node.id,
        tone: ctx.lastCheckStatus === "FAIL" ? "critical" : ctx.lastCheckStatus === "WARN" ? "warn" : "ok"
      });
    }
  }

  const heartbeatAt = input.project?.heartbeats?.[0]?.receivedAt ?? null;
  if (heartbeatAt) {
    items.push({
      id: `heartbeat-${heartbeatAt}`,
      kind: "heartbeat",
      title: "Project heartbeat",
      detail: `Received ${relativeTime(heartbeatAt, nowMs)}`,
      at: heartbeatAt,
      href: `/projects/${input.projectId}/activity`,
      serviceId: null,
      tone: "neutral"
    });
  }

  const insight = buildFactualInsight({
    topology: input.topology,
    project: input.project,
    checkSummary: input.checkResults?.summary ?? null,
    nowMs
  });
  if (insight) {
    items.push({
      id: `insight-${insight}`,
      kind: "insight",
      title: "Ops insight",
      detail: insight,
      at: input.topology.generatedAt,
      href: undefined,
      serviceId: null,
      tone: "neutral"
    });
  }

  const selectedIncidentIds = new Set(
    selectedId ? (input.topology.nodeContext[selectedId]?.unresolvedIncidents ?? []).map((row) => row.id) : []
  );
  const selectedAlertIds = new Set(
    selectedId ? (input.topology.nodeContext[selectedId]?.openAlerts ?? []).map((row) => row.id) : []
  );

  const filtered = selectedId
    ? items.filter((item) => {
        if (item.kind === "insight" || item.kind === "heartbeat") return true;
        if (item.kind === "incident") {
          return selectedIncidentIds.has(item.id.replace(/^incident-/, ""));
        }
        if (item.kind === "alert") {
          return item.serviceId === selectedId || selectedAlertIds.has(item.id.replace(/^alert-/, ""));
        }
        if (item.serviceId) return item.serviceId === selectedId;
        return item.kind === "heal";
      })
    : items;

  return filtered
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
};
