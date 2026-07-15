"use client";

import { useState } from "react";
import type { ClassifiedTopologyError } from "./topology-error-classify";

type Props = {
  error: ClassifiedTopologyError;
  lastSuccessfulAt: string | null;
  autoRetrying?: boolean;
  onRetry?: () => void;
};

export function TopologyRefreshBanner({
  error,
  lastSuccessfulAt,
  autoRetrying = true,
  onRetry
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const lastLabel = lastSuccessfulAt
    ? `Last good ${new Date(lastSuccessfulAt).toLocaleTimeString()}`
    : "No successful update yet";

  return (
    <section
      className={`topology-refresh-banner topology-refresh-banner--compact topology-refresh-banner--${error.kind}`}
      role="status"
      aria-live="polite"
      data-testid="topology-refresh-banner"
      data-kind={error.kind}
    >
      <div className="topology-refresh-banner-main">
        <div className="topology-refresh-banner-copy">
          <p className="topology-refresh-banner-title">
            <span className="topology-refresh-banner-dot" aria-hidden="true" />
            {error.title}
          </p>
          <p className="topology-refresh-banner-meta">
            {error.explanation} · {lastLabel}
            {autoRetrying ? " · Retrying…" : null}
          </p>
        </div>
        <div className="topology-refresh-banner-actions">
          {onRetry ? (
            <button
              type="button"
              className="secondary-button"
              onClick={onRetry}
              data-testid="topology-refresh-banner-retry"
            >
              Retry now
            </button>
          ) : null}
          <button
            type="button"
            className="secondary-button topology-refresh-banner-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            data-testid="topology-refresh-banner-toggle"
          >
            {expanded ? "Hide details" : "Details"}
          </button>
        </div>
      </div>
      {expanded ? (
        <pre className="topology-refresh-banner-details" data-testid="topology-refresh-banner-details">
          {error.invocationId ? `Invocation ID: ${error.invocationId}\n\n` : null}
          {error.technicalDetails}
        </pre>
      ) : null}
    </section>
  );
}
