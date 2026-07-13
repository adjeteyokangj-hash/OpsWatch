"use client";

import { formatRelativeTime, type OrganizationIntegrationSummary } from "../../lib/integrations";

type IntegrationsOverviewSummaryProps = {
  summary: OrganizationIntegrationSummary;
  projectCount: number;
};

export const IntegrationsOverviewSummary = ({ summary, projectCount }: IntegrationsOverviewSummaryProps) => (
  <section className="panel integrations-overview-summary">
    <div className="section-head">
      <div>
        <h2>External integrations</h2>
        <p>Operational provider connections across {projectCount} application{projectCount === 1 ? "" : "s"}.</p>
      </div>
    </div>
    <dl className="integrations-overview-summary__stats">
      <div>
        <dt>Connected</dt>
        <dd>{summary.connected}</dd>
      </div>
      <div>
        <dt>Require attention</dt>
        <dd>{summary.requireAttention}</dd>
      </div>
      <div>
        <dt>Failed</dt>
        <dd>{summary.failed}</dd>
      </div>
      <div>
        <dt>Last validation</dt>
        <dd>{formatRelativeTime(summary.lastValidatedAt)}</dd>
      </div>
    </dl>
  </section>
);
