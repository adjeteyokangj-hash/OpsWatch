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

export type ProviderCapabilityAvailability = "required" | "optional" | "unavailable";

type ConnectionTileProps = {
  projectId: string;
  type: IntegrationType;
  integration?: ProjectIntegration;
  validating?: boolean;
  onValidate?: () => void;
  compact?: boolean;
  capabilityAvailability?: ProviderCapabilityAvailability;
  capabilityDescription?: string;
};

export const ConnectionTile = ({
  projectId,
  type,
  integration,
  validating = false,
  onValidate,
  compact = false,
  capabilityAvailability = "optional",
  capabilityDescription
}: ConnectionTileProps) => {
  const configuredStatus = integrationTileStatus(integration, validating);
  const status = integration
    ? configuredStatus
    : capabilityAvailability === "required"
      ? configuredStatus
      : capabilityAvailability === "optional"
        ? { icon: "○", label: "Optional" }
        : { icon: "—", label: "Not available" };
  const canConfigure = Boolean(integration) || capabilityAvailability !== "unavailable";

  return (
    <article className={`connection-tile ${compact ? "connection-tile--compact" : ""}`}>
      <div className="connection-tile__head">
        <strong>{providerDisplayName(type)}</strong>
        <span className="connection-tile__status">
          <span aria-hidden="true">{status.icon}</span>
          <span>{status.label}</span>
        </span>
      </div>

      {capabilityDescription ? <p className="table-subtle">{capabilityDescription}</p> : null}

      {!compact && integration ? (
        <dl className="connection-tile__meta">
          {integration.validationDetails?.account?.mode ? (
            <div>
              <dt>Mode</dt>
              <dd>{integration.validationDetails.account.mode === "test" ? "Test" : "Live"}</dd>
            </div>
          ) : null}
          <div>
            <dt>Last validation</dt>
            <dd>{formatRelativeTime(integration.lastValidatedAt)}</dd>
          </div>
          {integration.validationDetails?.webhook ? (
            <div>
              <dt>Webhook</dt>
              <dd>
                {integration.validationDetails.webhook.verified
                  ? "Verified"
                  : integration.validationDetails.webhook.configured
                    ? "Configured"
                    : "Not configured"}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {canConfigure ? (
        <div className="connection-tile__actions">
          <Link className="secondary-button" href={integrationProviderPath(projectId, type)}>
            {integration ? "Configure" : capabilityAvailability === "required" ? "Set up" : "Add optional"}
          </Link>
          {integration && onValidate ? (
            <button
              type="button"
              className="primary-button"
              onClick={onValidate}
              disabled={validating}
            >
              {validating ? "Validating..." : "Validate"}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="table-subtle">No configuration is required until this application exposes a supported endpoint.</p>
      )}
    </article>
  );
};
