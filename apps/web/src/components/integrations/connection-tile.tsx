"use client";

import Link from "next/link";
import {
  formatRelativeTime,
  integrationProviderPath,
  integrationTileStatus,
  providerDisplayName,
  type IntegrationType,
  type ProjectIntegration
} from "../../lib/integrations";

type ConnectionTileProps = {
  projectId: string;
  type: IntegrationType;
  integration?: ProjectIntegration;
  validating?: boolean;
  onValidate?: () => void;
  compact?: boolean;
};

export const ConnectionTile = ({
  projectId,
  type,
  integration,
  validating = false,
  onValidate,
  compact = false
}: ConnectionTileProps) => {
  const status = integrationTileStatus(integration, validating);
  const details = integration?.validationDetails;

  return (
    <article className={`connection-tile ${compact ? "connection-tile--compact" : ""}`}>
      <div className="connection-tile__head">
        <strong>{providerDisplayName(type)}</strong>
        <span className="connection-tile__status">
          <span aria-hidden="true">{status.icon}</span>
          <span>{status.label}</span>
        </span>
      </div>

      {!compact ? (
        <dl className="connection-tile__meta">
          {details?.account?.mode ? (
            <div>
              <dt>Mode</dt>
              <dd>{details.account.mode === "test" ? "Test" : "Live"}</dd>
            </div>
          ) : null}
          <div>
            <dt>Last validation</dt>
            <dd>{formatRelativeTime(integration?.lastValidatedAt)}</dd>
          </div>
          {details?.webhook ? (
            <div>
              <dt>Webhook</dt>
              <dd>{details.webhook.verified ? "Verified" : details.webhook.configured ? "Configured" : "Not configured"}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div className="connection-tile__actions">
        <Link className="secondary-button" href={integrationProviderPath(projectId, type)}>
          Configure
        </Link>
        {onValidate ? (
          <button
            type="button"
            className="primary-button"
            onClick={onValidate}
            disabled={validating || !integration}
          >
            {validating ? "Validating..." : "Validate"}
          </button>
        ) : null}
      </div>
    </article>
  );
};
