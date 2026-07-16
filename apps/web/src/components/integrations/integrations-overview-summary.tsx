"use client";

import { PageSection } from "../ui/page-section";
import { formatRelativeTime, type OrganizationIntegrationSummary } from "../../lib/integrations";

type IntegrationsOverviewSummaryProps = {
  summary: OrganizationIntegrationSummary;
  projectCount: number;
};

export const IntegrationsOverviewSummary = ({ summary, projectCount }: IntegrationsOverviewSummaryProps) => (
  <PageSection
    title="External integrations"
    description={`Operational provider connections across ${projectCount} application${projectCount === 1 ? "" : "s"}.`}
    className="integrations-overview-summary"
    persistKey="integrations:overview-summary"
  >
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
  </PageSection>
);
