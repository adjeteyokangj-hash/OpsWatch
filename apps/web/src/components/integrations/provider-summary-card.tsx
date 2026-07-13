"use client";

import Link from "next/link";
import { ConnectionStatusBadge } from "../../components/integrations/provider-dashboard";
import {
  formatRelativeTime,
  healthLabel,
  providerDisplayName,
  resolveConnectionState,
  type IntegrationType,
  type ProjectIntegration
} from "../../lib/integrations";

type ProjectOption = {
  id: string;
  name: string;
  slug: string;
};

type ProviderSummaryCardProps = {
  project: ProjectOption;
  type: IntegrationType;
  integration?: ProjectIntegration;
  validating?: boolean;
  onValidate?: () => void;
};

export const ProviderSummaryCard = ({
  project,
  type,
  integration,
  validating = false,
  onValidate
}: ProviderSummaryCardProps) => {
  const state = resolveConnectionState(integration, validating);
  const details = integration?.validationDetails;

  return (
    <article className="provider-summary-card">
      <div className="provider-summary-card__head">
        <div>
          <strong>{providerDisplayName(type)}</strong>
          <p className="table-subtle">{integration?.name || `${type.toLowerCase()} integration`}</p>
        </div>
        <ConnectionStatusBadge integration={integration} validating={validating} />
      </div>

      <dl className="provider-summary-card__stats">
        <div>
          <dt>Health</dt>
          <dd>{healthLabel(details?.health)}</dd>
        </div>
        <div>
          <dt>Last validation</dt>
          <dd>{formatRelativeTime(integration?.lastValidatedAt)}</dd>
        </div>
        {details?.account?.name ? (
          <div>
            <dt>Connected account</dt>
            <dd>{details.account.name}</dd>
          </div>
        ) : null}
        {details?.account?.mode ? (
          <div>
            <dt>Mode</dt>
            <dd>{details.account.mode === "test" ? "Test" : "Live"}</dd>
          </div>
        ) : null}
      </dl>

      {integration?.validationMessage && state !== "connected" ? (
        <p className="table-subtle">{integration.validationMessage}</p>
      ) : null}

      <div className="channel-actions">
        <Link className="secondary-button" href={`/projects/${project.id}/integrations/${type.toLowerCase()}`}>
          Configure
        </Link>
        <button
          type="button"
          className="primary-button"
          onClick={onValidate}
          disabled={validating || !integration}
        >
          {validating ? "Validating..." : "Validate"}
        </button>
      </div>
    </article>
  );
};
