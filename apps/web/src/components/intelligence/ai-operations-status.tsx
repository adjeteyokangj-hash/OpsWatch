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
    const pred = status.capabilities.find((c) => c.id === "prediction_engine");
    const hb = status.capabilities.find((c) => c.id === "worker_heartbeat");
    return (
      <section className="ai-ops-status ai-ops-status--compact" data-testid="ai-ops-status-compact" data-tone={status.overall.tone}>
        <p className="ai-ops-status__compact-line">
          <strong>AI ops:</strong> {status.overall.modeLabel}
          {" · "}
          Predictions {pred ? toneLabel(pred.tone).toLowerCase() : "—"}
          {" · "}
          Heartbeat {hb ? toneLabel(hb.tone).toLowerCase() : "—"}
          {status.lastAiDecision.at ? (
            <>
              {" · "}
              Last decision {formatWhen(status.lastAiDecision.at)}
            </>
          ) : null}
          {projectId ? (
            <>
              {" · "}
              <Link href={`/projects/${projectId}/settings?tab=automation`}>Automation mode</Link>
            </>
          ) : (
            <>
              {" · "}
              <Link href="/intelligence">Full AI status</Link>
            </>
          )}
        </p>
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
        {status.capabilities.map((cap) => (
          <li
            key={cap.id}
            className={`ai-ops-status__item ai-ops-status__item--${cap.tone}`}
            data-capability={cap.id}
            data-tone={cap.tone}
          >
            <div className="ai-ops-status__item-head">
              <strong>{cap.label}</strong>
              <StatusBadge label={toneLabel(cap.tone)} tone={toneBadge(cap.tone)} />
            </div>
            <p className="muted">{cap.summary}</p>
            {cap.lastEvidenceAt ? (
              <p className="ai-ops-status__evidence muted">Evidence: {formatWhen(cap.lastEvidenceAt)}</p>
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
