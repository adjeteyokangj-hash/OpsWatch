"use client";

import { useState } from "react";
import type { ClassifiedTopologyError } from "./topology-error-classify";

type Props = {
  error: ClassifiedTopologyError;
  lastSuccessfulAt: string | null;
  autoRetrying?: boolean;
};

export function TopologyRefreshBanner({ error, lastSuccessfulAt, autoRetrying = true }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section
      className="panel topology-refresh-banner"
      role="status"
      aria-live="polite"
      data-testid="topology-refresh-banner"
      data-kind={error.kind}
    >
      <div className="topology-refresh-banner-main">
        <div>
          <p className="topology-refresh-banner-title">{error.title}</p>
          <p className="topology-refresh-banner-body">{error.explanation}</p>
          <p className="topology-refresh-banner-meta">
            {lastSuccessfulAt
              ? `Last successful update ${new Date(lastSuccessfulAt).toLocaleString()}`
              : "No successful update in this session yet"}
            {autoRetrying ? " · Retrying automatically…" : null}
          </p>
        </div>
        <button
          type="button"
          className="secondary-button topology-refresh-banner-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          data-testid="topology-refresh-banner-toggle"
        >
          {expanded ? "Hide details" : "View details"}
        </button>
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
