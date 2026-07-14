import type { ProjectTopologyResponse, TopologyNode } from "./topology-types";

/** Factual timeline kinds only — no invented signal types. */
export type LiveOpsKind =
  | "alert"
  | "incident"
  | "heal"
  | "check"
  | "heartbeat"
  | "deploy"
  | "dependency"
  | "insight";

export type LiveOpsItem = {
  id: string;
  kind: LiveOpsKind;
  /** Primary timeline headline (e.g. "Heartbeat received"). */
  title: string;
  /** Optional subject line (service name, dependency pair, version). */
  subject?: string;
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

export type ChangeEventRow = {
  id: string;
  eventType: string;
  summary: string;
  occurredAt: string;
  serviceId?: string | null;
  actor?: string | null;
  detailsJson?: Record<string, unknown> | null;
};

export type ServiceDependencyRow = {
  id: string;
  fromServiceId: string;
  toServiceId: string;
  dependencyType?: string;
  isActive?: boolean;
  createdAt: string;
  FromService?: { id: string; name: string } | null;
  ToService?: { id: string; name: string } | null;
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

export type ProjectEventRow = {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  serviceId?: string | null;
  severity?: string;
};

export type ProjectSignalSource = {
  createdAt?: string | null;
  alerts?: Array<{
    id: string;
    title: string;
    severity?: string;
    status: string;
    lastSeenAt: string;
    resolvedAt?: string | null;
    serviceId?: string | null;
  }>;
  incidents?: Array<{
    id: string;
    title: string;
    severity?: string;
    status: string;
    openedAt: string;
    resolvedAt?: string | null;
    rootCause?: string | null;
    serviceIds?: string[];
  }>;
  heartbeats?: Array<{
    receivedAt: string;
    status?: string;
    environment?: string;
    appVersion?: string | null;
    commitSha?: string | null;
    message?: string | null;
  }>;
  events?: ProjectEventRow[];
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

export type OpsInsight = {
  id: string;
  text: string;
  /** What facts backed this insight — shown for transparency. */
  evidence: string;
};

export type LearningStageId =
  | "collecting_signals"
  | "learning_dependencies"
  | "building_baselines"
  | "recurring_patterns"
  | "prediction_ready";

export type LearningProgression = {
  stage: LearningStageId;
  label: string;
  detail: string;
  /** Only present when derived from real evidence density — never invented. */
  confidencePercent: number | null;
  ageDays: number;
  signalCount: number;
  dependencyCount: number;
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

const formatClock = (value: string, nowMs: number): string => {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return "—";
  const ageMs = nowMs - ms;
  if (ageMs < 24 * 60 * 60 * 1000 && ageMs > -60_000) {
    return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

const healTitle = (action: string): string => {
  const upper = action.toUpperCase();
  if (upper === "RESTART_WORKER") return "Worker auto-restarted";
  if (upper === "RESTART_SERVICE") return "Service restarted";
  if (upper === "ROLLBACK_DEPLOYMENT") return "Deployment rolled back";
  const cleaned = action.replace(/_/g, " ").toLowerCase();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

const isRestartAction = (action: string): boolean => /RESTART_(WORKER|SERVICE)/i.test(action);

const isDeployChangeType = (eventType: string): boolean =>
  /(DEPLOY|ROLLBACK|RELEASE)/i.test(eventType);

const isDeployProjectEvent = (type: string): boolean =>
  /DEPLOYMENT_STARTED|DEPLOYMENT_FINISHED|DEPLOY_FAILED/i.test(type);

const versionFromChange = (row: ChangeEventRow): string | null => {
  const details = row.detailsJson ?? {};
  const candidates = [details.version, details.appVersion, details.commitSha, details.release];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const shaMatch = row.summary.match(/\b([0-9a-f]{7,40})\b/i);
  return shaMatch?.[1] ?? null;
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

/** Short status line used above the timeline when no correlation insight exists. */
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

/**
 * Rule-based Ops Insights — only emitted when correlated facts exist.
 * Skipped (no invention): latency-vs-baseline (%), queue depth, ML predictions.
 */
export const buildOpsInsights = (input: {
  remediationLogs?: RemediationLogRow[];
  changeEvents?: ChangeEventRow[];
  projectEvents?: ProjectEventRow[];
  projectId: string;
  nowMs?: number;
  limit?: number;
}): OpsInsight[] => {
  const nowMs = input.nowMs ?? Date.now();
  const limit = input.limit ?? 3;
  const insights: OpsInsight[] = [];

  const projectLogs = (input.remediationLogs ?? []).filter(
    (row) => !row.projectId || row.projectId === input.projectId
  );
  const restarts = projectLogs
    .filter((row) => isRestartAction(row.action))
    .map((row) => ({
      ...row,
      atMs: new Date(row.executedAt ?? row.createdAt).getTime()
    }))
    .filter((row) => !Number.isNaN(row.atMs))
    .sort((a, b) => b.atMs - a.atMs);

  const deployTimes: Array<{ atMs: number; label: string }> = [];
  for (const row of input.changeEvents ?? []) {
    if (!isDeployChangeType(row.eventType)) continue;
    const atMs = new Date(row.occurredAt).getTime();
    if (Number.isNaN(atMs)) continue;
    deployTimes.push({ atMs, label: row.summary });
  }
  for (const row of input.projectEvents ?? []) {
    if (!isDeployProjectEvent(row.type)) continue;
    const atMs = new Date(row.createdAt).getTime();
    if (Number.isNaN(atMs)) continue;
    deployTimes.push({ atMs, label: row.message || row.type });
  }
  deployTimes.sort((a, b) => b.atMs - a.atMs);

  // Rule: ≥2 restarts within 5 minutes of a deployment (either side).
  if (restarts.length >= 2 && deployTimes.length > 0) {
    const windowMs = 5 * 60_000;
    const nearDeploy = restarts.filter((restart) =>
      deployTimes.some((deploy) => Math.abs(restart.atMs - deploy.atMs) <= windowMs)
    );
    if (nearDeploy.length >= 2) {
      const sample = Math.min(nearDeploy.length, 4);
      insights.push({
        id: "restarts-near-deploy",
        text: `The last ${sample} worker restart${sample === 1 ? "" : "s"} occurred within five minutes of a deployment.`,
        evidence: `${nearDeploy.length} restart action(s) correlated with ${deployTimes.length} deploy signal(s)`
      });
    }
  }

  // Rule: ≥3 restarts in a 15-minute burst (no deploy required).
  if (restarts.length >= 3) {
    const newest = restarts[0]!.atMs;
    const burst = restarts.filter((row) => newest - row.atMs <= 15 * 60_000);
    if (burst.length >= 3 && !insights.some((row) => row.id === "restarts-near-deploy")) {
      insights.push({
        id: "restart-burst",
        text: `${burst.length} worker/service restarts occurred within a 15-minute window.`,
        evidence: `Remediation actions: ${burst.map((row) => row.action).join(", ")}`
      });
    }
  }

  // Rule: recent deploy failure event still within lookback.
  const failedDeploy = (input.projectEvents ?? []).find((row) => row.type === "DEPLOY_FAILED");
  if (failedDeploy) {
    const ageMs = nowMs - new Date(failedDeploy.createdAt).getTime();
    if (ageMs >= 0 && ageMs < 24 * 60 * 60 * 1000) {
      insights.push({
        id: "deploy-failed",
        text: `A deployment failure was recorded ${relativeTime(failedDeploy.createdAt, nowMs)}.`,
        evidence: failedDeploy.message || "DEPLOY_FAILED event"
      });
    }
  }

  return insights.slice(0, limit);
};

/**
 * Honest learning maturity from project age + observed signal volume.
 * Confidence % only when evidence density supports a real ratio — never invented.
 */
export const deriveLearningProgression = (input: {
  project?: ProjectSignalSource | null;
  topology?: ProjectTopologyResponse | null;
  dependencyCount?: number;
  checkResultCount?: number;
  remediationCount?: number;
  changeEventCount?: number;
  nowMs?: number;
}): LearningProgression => {
  const nowMs = input.nowMs ?? Date.now();
  const createdAt = input.project?.createdAt ?? null;
  const earliestHeartbeat = [...(input.project?.heartbeats ?? [])]
    .map((row) => new Date(row.receivedAt).getTime())
    .filter((ms) => !Number.isNaN(ms))
    .sort((a, b) => a - b)[0];
  const originMs = createdAt
    ? new Date(createdAt).getTime()
    : earliestHeartbeat ?? nowMs;
  const ageDays = Math.max(0, Math.floor((nowMs - originMs) / (24 * 60 * 60 * 1000)));

  const heartbeatCount = input.project?.heartbeats?.length ?? 0;
  const alertCount = input.project?.alerts?.length ?? 0;
  const eventCount = input.project?.events?.length ?? 0;
  const checkCount = input.checkResultCount ?? 0;
  const remediations = input.remediationCount ?? 0;
  const deploys = input.changeEventCount ?? 0;
  const signalCount = heartbeatCount + alertCount + eventCount + checkCount + remediations + deploys;

  const depEdges =
    input.dependencyCount ??
    input.topology?.edges.filter((edge) => edge.type === "DEPENDENCY").length ??
    0;
  const nodeCount = input.topology?.nodes.length ?? 0;

  // Stage heuristics (documented): age + signal/graph density, not fake ML.
  let stage: LearningStageId = "collecting_signals";
  if (ageDays >= 7 || (signalCount >= 20 && heartbeatCount >= 3)) {
    stage = "learning_dependencies";
  }
  if (ageDays >= 14 || (depEdges >= 2 && signalCount >= 40)) {
    stage = "building_baselines";
  }
  if (ageDays >= 30 || (checkCount >= 50 && signalCount >= 80)) {
    stage = "recurring_patterns";
  }
  if (ageDays >= 90 && signalCount >= 120 && depEdges >= 3) {
    stage = "prediction_ready";
  }

  const labels: Record<LearningStageId, { label: string; detail: string }> = {
    collecting_signals: {
      label: "Week 1: Collecting signals…",
      detail: "Gathering heartbeats, checks, and alerts before pattern analysis begins."
    },
    learning_dependencies: {
      label: "Week 2: Learning dependencies…",
      detail:
        depEdges > 0
          ? `Mapped ${depEdges} runtime relationship${depEdges === 1 ? "" : "s"} across ${nodeCount || "your"} nodes.`
          : "Waiting for dependency edges or hierarchy links to accumulate."
    },
    building_baselines: {
      label: "Month 1: Building performance baselines…",
      detail: "Accumulating check latency and availability history for later comparison."
    },
    recurring_patterns: {
      label: "Month 3: Recurring patterns identified…",
      detail: "Enough history to surface evidence-backed correlations when they appear."
    },
    prediction_ready: {
      label: "Month 6: Evidence density high",
      detail: "Sufficient history to weight recurring correlations honestly."
    }
  };

  // Real confidence only: share of desired evidence slots that are populated.
  // Slots: age≥90d, signals≥120, deps≥3, checks≥50, remediations≥5, deploys≥3.
  let confidencePercent: number | null = null;
  if (stage === "prediction_ready" || (ageDays >= 180 && signalCount >= 200)) {
    const slots = [
      ageDays >= 90,
      signalCount >= 120,
      depEdges >= 3,
      checkCount >= 50,
      remediations >= 5,
      deploys >= 3
    ];
    const filled = slots.filter(Boolean).length;
    confidencePercent = Math.round((filled / slots.length) * 100);
  }

  const copy = labels[stage];
  const label =
    confidencePercent != null
      ? `Month 6: Prediction confidence: ${confidencePercent}%`
      : copy.label;

  return {
    stage,
    label,
    detail: copy.detail,
    confidencePercent,
    ageDays,
    signalCount,
    dependencyCount: depEdges
  };
};

export const buildLiveOpsItems = (input: {
  topology: ProjectTopologyResponse;
  project?: ProjectSignalSource | null;
  remediationLogs?: RemediationLogRow[];
  checkResults?: CheckListResponse | null;
  changeEvents?: ChangeEventRow[];
  dependencies?: ServiceDependencyRow[];
  selectedNode?: TopologyNode | null;
  projectId: string;
  nowMs?: number;
  limit?: number;
}): LiveOpsItem[] => {
  const nowMs = input.nowMs ?? Date.now();
  const limit = input.limit ?? 16;
  const selectedId = input.selectedNode?.id ?? null;
  const items: LiveOpsItem[] = [];
  const serviceName = (serviceId: string | null | undefined): string | undefined => {
    if (!serviceId) return undefined;
    const fromTopo = input.topology.nodes.find((node) => node.id === serviceId)?.name;
    if (fromTopo) return fromTopo;
    return input.project?.services?.find((service) => service.id === serviceId)?.name;
  };

  const alerts = input.project?.alerts ?? [];
  for (const alert of alerts.slice(0, 8)) {
    const restored = alert.status === "RESOLVED" && alert.resolvedAt;
    items.push({
      id: `alert-${alert.id}`,
      kind: "alert",
      title: restored ? "Health restored" : alert.title,
      subject: serviceName(alert.serviceId) ?? undefined,
      detail: restored
        ? `Alert resolved · ${relativeTime(alert.resolvedAt, nowMs)}`
        : `${alert.severity ?? "ALERT"} · ${alert.status} · ${relativeTime(alert.lastSeenAt, nowMs)}`,
      at: restored ? (alert.resolvedAt as string) : alert.lastSeenAt,
      href: `/alerts/${alert.id}`,
      serviceId: alert.serviceId ?? null,
      tone: restored
        ? "ok"
        : alert.severity === "CRITICAL" || alert.severity === "HIGH"
          ? "critical"
          : "warn"
    });
  }

  const incidents = input.project?.incidents ?? [];
  for (const incident of incidents.slice(0, 8)) {
    if (incident.status === "RESOLVED" && incident.resolvedAt) {
      items.push({
        id: `incident-resolved-${incident.id}`,
        kind: "incident",
        title: "Health restored",
        subject: incident.title,
        detail: `Incident resolved · ${relativeTime(incident.resolvedAt, nowMs)}`,
        at: incident.resolvedAt,
        href: `/incidents/${incident.id}`,
        serviceId: incident.serviceIds?.[0] ?? null,
        tone: "ok"
      });
      continue;
    }
    if (incident.status === "RESOLVED") continue;
    items.push({
      id: `incident-${incident.id}`,
      kind: "incident",
      title: incident.title,
      subject: serviceName(incident.serviceIds?.[0]) ?? undefined,
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
  for (const log of projectLogs.slice(0, 10)) {
    const when = log.executedAt ?? log.createdAt;
    const mode = log.executionMode ? ` · ${log.executionMode.toLowerCase()}` : "";
    items.push({
      id: `heal-${log.id}`,
      kind: "heal",
      title: healTitle(log.action),
      subject: serviceName(log.serviceId) ?? undefined,
      detail: `${log.status}${mode}${log.resultJson?.summary ? ` · ${log.resultJson.summary}` : ""} · ${relativeTime(when, nowMs)}`,
      at: when,
      href: log.incidentId ? `/incidents/${log.incidentId}` : `/projects/${input.projectId}/automation`,
      serviceId: log.serviceId ?? null,
      tone:
        log.status === "FAILED" || log.status === "BLOCKED"
          ? "critical"
          : log.status === "SUCCEEDED" || log.status === "EXECUTED"
            ? "ok"
            : "neutral"
    });
  }

  const checkItems = input.checkResults?.items ?? [];
  for (const check of checkItems.slice(0, 10)) {
    const latest = check.latestResult;
    if (!latest) continue;
    if (latest.status === "PASS" && items.length > 8) continue;
    const latency = latest.responseTimeMs != null ? ` · ${latest.responseTimeMs} ms` : "";
    const title =
      latest.status === "PASS"
        ? "Health check passed"
        : latest.status === "FAIL"
          ? "Health check failed"
          : "Health check warning";
    items.push({
      id: `check-${check.id}-${latest.checkedAt}`,
      kind: "check",
      title,
      subject: `${check.service.name}: ${check.name}`,
      detail: `${latest.status}${latency} · ${relativeTime(latest.checkedAt, nowMs)}`,
      at: latest.checkedAt,
      href: `/checks/${check.id}`,
      serviceId: check.service.id,
      tone: latest.status === "FAIL" ? "critical" : latest.status === "WARN" ? "warn" : "ok"
    });
  }

  if (checkItems.length === 0) {
    for (const node of input.topology.nodes) {
      const ctx = input.topology.nodeContext[node.id];
      if (!ctx?.lastCheckAt || !ctx.lastCheckStatus) continue;
      items.push({
        id: `topo-check-${node.id}-${ctx.lastCheckAt}`,
        kind: "check",
        title:
          ctx.lastCheckStatus === "PASS"
            ? "Health check passed"
            : ctx.lastCheckStatus === "FAIL"
              ? "Health check failed"
              : "Health check warning",
        subject: node.name,
        detail: `${ctx.lastCheckStatus} · ${relativeTime(ctx.lastCheckAt, nowMs)}`,
        at: ctx.lastCheckAt,
        href: `/checks?projectId=${input.projectId}&serviceId=${node.id}`,
        serviceId: node.id,
        tone: ctx.lastCheckStatus === "FAIL" ? "critical" : ctx.lastCheckStatus === "WARN" ? "warn" : "ok"
      });
    }
  }

  const heartbeats = input.project?.heartbeats ?? [];
  for (const heartbeat of heartbeats.slice(0, 3)) {
    const bits = [
      heartbeat.environment,
      heartbeat.appVersion ? `v${heartbeat.appVersion}` : null,
      heartbeat.commitSha ? heartbeat.commitSha.slice(0, 7) : null,
      heartbeat.status
    ].filter(Boolean);
    items.push({
      id: `heartbeat-${heartbeat.receivedAt}`,
      kind: "heartbeat",
      title: "Heartbeat received",
      subject: bits.length > 0 ? bits.join(" · ") : input.topology.project.name,
      detail: `Received ${relativeTime(heartbeat.receivedAt, nowMs)}`,
      at: heartbeat.receivedAt,
      href: `/projects/${input.projectId}/activity`,
      serviceId: null,
      tone: heartbeat.status && /down|fail|error/i.test(heartbeat.status) ? "warn" : "neutral"
    });
  }

  const changeEvents = input.changeEvents ?? [];
  for (const row of changeEvents.slice(0, 8)) {
    if (!isDeployChangeType(row.eventType) && !/DEPLOY/i.test(row.eventType)) continue;
    const version = versionFromChange(row);
    items.push({
      id: `deploy-change-${row.id}`,
      kind: "deploy",
      title: "Deployment detected",
      subject: version
        ? `version ${version}`
        : serviceName(row.serviceId) ?? row.summary,
      detail: `${row.eventType}${row.actor ? ` · ${row.actor}` : ""} · ${relativeTime(row.occurredAt, nowMs)}`,
      at: row.occurredAt,
      href: `/projects/${input.projectId}/activity`,
      serviceId: row.serviceId ?? null,
      tone: /FAIL|ROLLBACK/i.test(row.eventType) ? "warn" : "neutral"
    });
  }

  // Fallback: project Event rows when change-events API is empty.
  if (changeEvents.length === 0) {
    for (const row of (input.project?.events ?? []).slice(0, 8)) {
      if (!isDeployProjectEvent(row.type)) continue;
      items.push({
        id: `deploy-event-${row.id}`,
        kind: "deploy",
        title: row.type === "DEPLOY_FAILED" ? "Deployment failed" : "Deployment detected",
        subject: serviceName(row.serviceId) ?? row.message,
        detail: `${row.type} · ${relativeTime(row.createdAt, nowMs)}`,
        at: row.createdAt,
        href: `/projects/${input.projectId}/activity`,
        serviceId: row.serviceId ?? null,
        tone: row.type === "DEPLOY_FAILED" ? "critical" : "neutral"
      });
    }
  }

  const recentCutoff = nowMs - 7 * 24 * 60 * 60 * 1000;
  for (const dep of (input.dependencies ?? []).slice(0, 12)) {
    if (dep.isActive === false) continue;
    const createdMs = new Date(dep.createdAt).getTime();
    if (Number.isNaN(createdMs) || createdMs < recentCutoff) continue;
    const fromName = dep.FromService?.name ?? serviceName(dep.fromServiceId) ?? dep.fromServiceId;
    const toName = dep.ToService?.name ?? serviceName(dep.toServiceId) ?? dep.toServiceId;
    items.push({
      id: `dep-${dep.id}`,
      kind: "dependency",
      title: "Dependency discovered",
      subject: `${fromName} → ${toName}`,
      detail: `${dep.dependencyType ?? "RUNTIME"} · ${relativeTime(dep.createdAt, nowMs)}`,
      at: dep.createdAt,
      href: `/projects/${input.projectId}/topology`,
      serviceId: dep.fromServiceId,
      tone: "neutral"
    });
  }

  // Status insight stays as a compact timeline note only when no correlation insights exist upstream.
  const statusInsight = buildFactualInsight({
    topology: input.topology,
    project: input.project,
    checkSummary: input.checkResults?.summary ?? null,
    nowMs
  });
  if (statusInsight) {
    items.push({
      id: `insight-${statusInsight}`,
      kind: "insight",
      title: "Status summary",
      detail: statusInsight,
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
          const rawId = item.id.replace(/^incident-(resolved-)?/, "");
          return selectedIncidentIds.has(rawId) || item.serviceId === selectedId;
        }
        if (item.kind === "alert") {
          return item.serviceId === selectedId || selectedAlertIds.has(item.id.replace(/^alert-/, ""));
        }
        if (item.serviceId) return item.serviceId === selectedId;
        return item.kind === "heal" || item.kind === "deploy" || item.kind === "dependency";
      })
    : items;

  return filtered
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit)
    .map((item) => ({
      ...item,
      detail: item.detail.includes(formatClock(item.at, nowMs))
        ? item.detail
        : item.detail
    }));
};

export const formatTimelineClock = formatClock;
