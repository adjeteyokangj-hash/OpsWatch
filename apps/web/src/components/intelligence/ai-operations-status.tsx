"use client";

import Link from "next/link";
import { StatusBadge } from "../ui/status-badge";
import type { AiOperationsStatusPayload, OpsStatusTone } from "../../lib/api";

type Props = {
  status: AiOperationsStatusPayload | null | undefined;
  loading?: boolean;
  compact?: boolean;
  projectId?: string;
};

const toneBadge = (tone: OpsStatusTone): "success" | "warning" | "danger" => {
  if (tone === "green") return "success";
  if (tone === "amber") return "warning";
  return "danger";
};

const toneLabel = (tone: OpsStatusTone): string => {
  if (tone === "green") return "Active";
  if (tone === "amber") return "Waiting";
  return "Blocked";
};

const workerLabel = (tone: OpsStatusTone | undefined): string => {
  if (tone === "green") return "Running";
  if (tone === "amber") return "Needs attention";
  if (tone === "red") return "Unavailable";
  return "Unknown";
};

const predictionLabel = (
  tone: OpsStatusTone | undefined,
  evidence: Record<string, unknown> | undefined
): string => {
  if (evidence?.enabled === false) return "Off";
  if (tone === "green") return "Active";
  if (tone === "amber") return "Building evidence";
  if (tone === "red") return "Blocked";
  return "Unknown";
};

const formatWhen = (value: string | null | undefined): string => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

export function AiOperationsStatus({ status, loading, compact, projectId }: Props) {
  if (loading) {
    return (
      <section className={compact ? "ai-ops-status ai-ops-status--compact" : "ai-ops-status panel"} aria-busy="true">
        <p className="muted">Loading AI operations status…</p>
      </section>
    );
  }

  if (!status) {
    return (
      <section className={compact ? "ai-ops-status ai-ops-status--compact" : "ai-ops-status panel"}>
        <p className="muted">AI operations status unavailable.</p>
      </section>
    );
  }

  if (compact) {
    const prediction = status.capabilities.find((capability) => capability.id === "prediction_engine");
    const worker = status.capabilities.find((capability) => capability.id === "worker_heartbeat");
    const reviewHref = projectId
      ? `/projects/${projectId}/settings?tab=automation`
      : "/intelligence";
    const reviewLabel = projectId ? "Review automation settings" : "Review full AI status";

    return (
      <section
        className="ai-ops-status ai-ops-status--compact"
        data-testid="ai-ops-status-compact"
        data-tone={status.overall.tone}
      >
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <strong>AI operations</strong>
            <StatusBadge label={toneLabel(status.overall.tone)} tone={toneBadge(status.overall.tone)} />
          </div>
          <p style={{ margin: 0 }}>{status.overall.summary}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="meta-chip">Worker: {workerLabel(worker?.tone)}</span>
            <span className="meta-chip">
              Predictions: {predictionLabel(prediction?.tone, prediction?.evidence)}
            </span>
          </div>
          <Link className="text-link" href={reviewHref}>
            {reviewLabel} →
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="ai-ops-status panel" data-testid="ai-ops-status" data-tone={status.overall.tone} aria-labelledby="ai-ops-status-title">
      <div className="ai-ops-status__header">
        <h2 id="ai-ops-status-title">AI Operations Status</h2>
        <StatusBadge label={status.overall.modeLabel} tone={toneBadge(status.overall.tone)} />
      </div>
      <p className="muted ai-ops-status__lede">{status.overall.summary}</p>

      <div className="ai-ops-status__proof" data-testid="ai-ops-last-decision">
        <span className="snapshot-label">Last AI decision</span>
        <strong>{status.lastAiDecision.at ? formatWhen(status.lastAiDecision.at) : "None recorded"}</strong>
        {status.lastAiDecision.summary ? <p className="muted">{status.lastAiDecision.summary}</p> : null}
      </div>

      <ul className="ai-ops-status__list">
        {status.capabilities.map((capability) => (
          <li
            key={capability.id}
            className={`ai-ops-status__item ai-ops-status__item--${capability.tone}`}
            data-capability={capability.id}
            data-tone={capability.tone}
          >
            <div className="ai-ops-status__item-head">
              <strong>{capability.label}</strong>
              <StatusBadge label={toneLabel(capability.tone)} tone={toneBadge(capability.tone)} />
            </div>
            <p className="muted">{capability.summary}</p>
            {capability.lastEvidenceAt ? (
              <p className="ai-ops-status__evidence muted">Evidence: {formatWhen(capability.lastEvidenceAt)}</p>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="ai-ops-status__blocked" data-testid="ai-ops-blocked">
        <h3>Blocked capabilities</h3>
        {status.blocked.length === 0 ? (
          <p className="muted">None — no red/waiting blockers in the current proof window.</p>
        ) : (
          <ul>
            {status.blocked.map((row) => (
              <li key={row.id}>
                <strong>{row.label}:</strong> {row.reason}
              </li>
            ))}
          </ul>
        )}
      </div>

      {status.recentDecisions.length > 0 ? (
        <div className="ai-ops-status__recent" data-testid="ai-ops-recent-decisions">
          <h3>Recent AI decisions</h3>
          <ul>
            {status.recentDecisions.slice(0, 5).map((row) => (
              <li key={`${row.kind}-${row.id}`}>
                <span className="muted">{formatWhen(row.at)}</span>
                {" · "}
                <strong>{row.kind}</strong>
                {row.decisionType ? ` (${row.decisionType})` : ""}
                {" — "}
                {row.summary}
                {typeof row.confidence === "number" ? ` · conf ${Math.round(row.confidence * 100)}%` : ""}
                {row.outcome ? ` · ${row.outcome}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="ai-ops-status__footer muted">
        Green = enabled with recent evidence. Amber = enabled but waiting. Red = disabled, Monitor Only, or stale worker.
        {" "}
        <Link href="/projects">Open a project</Link>
        {" → Settings → Automation mode."}
      </p>
      <p className="muted" style={{ fontSize: "0.8rem" }}>
        As of {formatWhen(status.asOf)}
      </p>
    </section>
  );
}
