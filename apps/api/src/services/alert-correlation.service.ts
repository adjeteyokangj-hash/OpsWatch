import { createHash } from "crypto";

/**
 * Phase 6 — alert correlation and evidence-based incident intelligence helpers.
 * Pure ranking / taxonomy only; never invents root causes without evidence inputs.
 */

export type SignalLayer = "SIGNAL" | "ALERT" | "CORRELATED_INCIDENT";

export type RcaConfidenceLabel = "POSSIBLE" | "PROBABLE" | "CONFIRMED";

export type CorrelationAlertInput = {
  id: string;
  projectId: string;
  serviceId: string | null;
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  sourceType: string;
  sourceId?: string | null;
  fingerprint?: string | null;
  firstSeenAt: Date;
  lastSeenAt?: Date;
  occurrenceCount?: number;
  /** Optional trace / correlation id from OTEL or connector payload. */
  traceId?: string | null;
  changeEventId?: string | null;
};

export type CorrelationEdge = {
  fromServiceId: string;
  toServiceId: string;
};

export type FlappingAssessment = {
  isFlapping: boolean;
  score: number;
  reason: string;
};

export const CORRELATION_WINDOW_MS = 30 * 60_000;
export const REOPEN_COOLDOWN_MS = 15 * 60_000;
export const FLAPPING_OCCURRENCE_THRESHOLD = 5;
export const FLAPPING_WINDOW_MS = 60 * 60_000;

export const buildAlertFingerprint = (input: {
  projectId: string;
  serviceId?: string | null;
  sourceType: string;
  sourceId?: string | null;
  title: string;
}): string => {
  const raw = [
    input.projectId,
    input.serviceId ?? "",
    input.sourceType,
    input.sourceId ?? "",
    input.title.trim().toLowerCase()
  ].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
};

export const classifySignalLayer = (input: {
  hasLinkedIncident: boolean;
  correlatedAlertCount: number;
}): SignalLayer => {
  if (input.hasLinkedIncident && input.correlatedAlertCount > 1) return "CORRELATED_INCIDENT";
  if (input.hasLinkedIncident) return "ALERT";
  return "SIGNAL";
};

export const assessFlapping = (input: {
  occurrenceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  now?: Date;
}): FlappingAssessment => {
  const now = input.now ?? new Date();
  const spanMs = Math.max(1, input.lastSeenAt.getTime() - input.firstSeenAt.getTime());
  const windowActive = now.getTime() - input.firstSeenAt.getTime() <= FLAPPING_WINDOW_MS;
  const ratePerHour = input.occurrenceCount / (spanMs / 3_600_000);
  const score = Math.min(1, input.occurrenceCount / (FLAPPING_OCCURRENCE_THRESHOLD * 2) + ratePerHour / 20);

  if (windowActive && input.occurrenceCount >= FLAPPING_OCCURRENCE_THRESHOLD) {
    return {
      isFlapping: true,
      score,
      reason: `Alert repeated ${input.occurrenceCount} times within ${Math.round(FLAPPING_WINDOW_MS / 60_000)} minutes`
    };
  }

  return {
    isFlapping: false,
    score,
    reason: "Occurrence rate within normal bounds"
  };
};

export const canReopenIncident = (input: {
  resolvedAt: Date | null;
  now?: Date;
  cooldownMs?: number;
}): { allowed: boolean; reason: string } => {
  if (!input.resolvedAt) {
    return { allowed: false, reason: "Incident is not resolved" };
  }
  const now = input.now ?? new Date();
  const cooldown = input.cooldownMs ?? REOPEN_COOLDOWN_MS;
  const elapsed = now.getTime() - input.resolvedAt.getTime();
  if (elapsed < cooldown) {
    return {
      allowed: false,
      reason: `Reopen cooldown active for ${Math.ceil((cooldown - elapsed) / 60_000)} more minute(s)`
    };
  }
  return { allowed: true, reason: "Cooldown elapsed; reopen permitted" };
};

const neighborMap = (edges: CorrelationEdge[]): Map<string, Set<string>> => {
  const neighbors = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!neighbors.has(edge.fromServiceId)) neighbors.set(edge.fromServiceId, new Set());
    if (!neighbors.has(edge.toServiceId)) neighbors.set(edge.toServiceId, new Set());
    neighbors.get(edge.fromServiceId)!.add(edge.toServiceId);
    neighbors.get(edge.toServiceId)!.add(edge.fromServiceId);
  }
  return neighbors;
};

const componentOf = (serviceId: string, neighbors: Map<string, Set<string>>): Set<string> => {
  const found = new Set<string>();
  const queue = [serviceId];
  while (queue.length) {
    const current = queue.shift()!;
    if (found.has(current)) continue;
    found.add(current);
    queue.push(...(neighbors.get(current) ?? []));
  }
  return found;
};

/**
 * Group alerts by fingerprint, shared trace, shared change event, or dependency component.
 */
export const groupCorrelatedAlertsAdvanced = (
  alerts: CorrelationAlertInput[],
  edges: CorrelationEdge[],
  windowMs: number = CORRELATION_WINDOW_MS
): CorrelationAlertInput[][] => {
  if (alerts.length === 0) return [];

  const sorted = [...alerts].sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime());
  const neighbors = neighborMap(edges);
  const groups: CorrelationAlertInput[][] = [];

  for (const alert of sorted) {
    const match = groups.find((group) => {
      const anchor = group[0]!;
      if (anchor.projectId !== alert.projectId) return false;
      const withinWindow =
        Math.abs(alert.firstSeenAt.getTime() - anchor.firstSeenAt.getTime()) <= windowMs;
      if (!withinWindow) return false;

      if (alert.fingerprint && group.some((g) => g.fingerprint === alert.fingerprint)) {
        return true;
      }
      if (alert.traceId && group.some((g) => g.traceId && g.traceId === alert.traceId)) {
        return true;
      }
      if (
        alert.changeEventId &&
        group.some((g) => g.changeEventId && g.changeEventId === alert.changeEventId)
      ) {
        return true;
      }

      return group.some((existing) => {
        if (!existing.serviceId && !alert.serviceId) return true;
        if (existing.serviceId && alert.serviceId) {
          return componentOf(existing.serviceId, neighbors).has(alert.serviceId);
        }
        return false;
      });
    });

    if (match) match.push(alert);
    else groups.push([alert]);
  }

  return groups;
};

export const labelRcaConfidence = (input: {
  score: number;
  supportingEvidenceCount: number;
  operatorConfirmed?: boolean;
}): RcaConfidenceLabel => {
  if (input.operatorConfirmed) return "CONFIRMED";
  if (input.score >= 0.85 && input.supportingEvidenceCount >= 2) return "CONFIRMED";
  if (input.score >= 0.6 || input.supportingEvidenceCount >= 2) return "PROBABLE";
  return "POSSIBLE";
};

/**
 * Scenario A ranking helper: external dependency failure should outrank downstream symptoms.
 */
export const rankScenarioACandidates = (candidates: Array<{
  id: string;
  kind: "EXTERNAL_DEPENDENCY" | "DOWNSTREAM_ALERT" | "CHANGE_EVENT" | "OTHER";
  isUpstreamExternal: boolean;
  score: number;
}>): string[] =>
  [...candidates]
    .sort((a, b) => {
      const aBoost = a.isUpstreamExternal || a.kind === "EXTERNAL_DEPENDENCY" ? 1 : 0;
      const bBoost = b.isUpstreamExternal || b.kind === "EXTERNAL_DEPENDENCY" ? 1 : 0;
      if (bBoost !== aBoost) return bBoost - aBoost;
      return b.score - a.score;
    })
    .map((c) => c.id);

export const buildIncidentFingerprint = (alertFingerprints: string[]): string => {
  const sorted = [...alertFingerprints].filter(Boolean).sort();
  if (sorted.length === 0) return createHash("sha256").update("empty").digest("hex").slice(0, 32);
  return createHash("sha256").update(sorted.join(",")).digest("hex").slice(0, 32);
};
