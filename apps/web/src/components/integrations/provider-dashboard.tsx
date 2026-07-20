"use client";

import { PageSection } from "../ui/page-section";
import {
  connectionStateMeta,
  formatRelativeTime,
  healthLabel,
  resolveConnectionState,
  type ConnectionUiState,
  type IntegrationValidationDetails,
  type ProjectIntegration
} from "../../lib/integrations";

type ConnectionStatusBadgeProps = {
  integration?: ProjectIntegration | null;
  validating?: boolean;
};

export const ConnectionStatusBadge = ({ integration, validating = false }: ConnectionStatusBadgeProps) => {
  const state = resolveConnectionState(integration, validating);
  const meta = connectionStateMeta[state];
  return (
    <span className={`connection-status connection-status--${meta.tone}`}>
      <span aria-hidden="true">{meta.icon}</span>
      <span>{meta.label}</span>
    </span>
  );
};

type ProviderDashboardProps = {
  providerName: string;
  integration?: ProjectIntegration | null;
  validating?: boolean;
  onValidate?: () => void;
  onDisconnect?: () => void;
  disableActions?: boolean;
  persistKey?: string;
};

const checkIcon = (status: IntegrationValidationDetails["checks"][number]["status"]) => {
  if (status === "pass") return "✓";
  if (status === "fail") return "✗";
  if (status === "warn") return "!";
  return "…";
};

export const ProviderDashboard = ({
  providerName,
  integration,
  validating = false,
  onValidate,
  onDisconnect,
  disableActions = false,
  persistKey
}: ProviderDashboardProps) => {
  const state = resolveConnectionState(integration, validating);
  const meta = connectionStateMeta[state];
  const details = integration?.validationDetails ?? null;
  const mode = details?.account?.mode;

  return (
    <PageSection
      className="provider-dashboard"
      title={providerName}
      description="Connection health and validation status."
      persistKey={persistKey}
      actions={
        <span className={`connection-status connection-status--${meta.tone}`}>
          <span aria-hidden="true">{meta.icon}</span>
          <span>{meta.label}</span>
        </span>
      }
    >
      <dl className="provider-dashboard__stats">
        <div>
          <dt>Status</dt>
          <dd>{meta.label}</dd>
        </div>
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
        {mode ? (
          <div>
            <dt>Mode</dt>
            <dd>
              <span className={`mode-pill mode-pill--${mode}`}>
                {mode === "test" ? "🟡 Test mode" : "🟢 Live mode"}
              </span>
            </dd>
          </div>
        ) : null}
      </dl>

      {mode ? (
        <div className={`mode-banner mode-banner--${mode}`}>
          {mode === "test"
            ? "These credentials cannot process live payments."
            : "Production payments enabled. Double-check before validating in production."}
        </div>
      ) : null}

      {details?.checks?.length ? (
        <div className="validation-health-card">
          <h3>{providerName} connection</h3>
          <ul className="validation-health-list">
            {details.checks.map((check) => (
              <li key={check.id} className={`validation-health-item validation-health-item--${check.status}`}>
                <span aria-hidden="true">{checkIcon(check.status)}</span>
                <span>{check.label}</span>
              </li>
            ))}
          </ul>
          <p className="table-subtle">
            Last checked {formatRelativeTime(details.lastCheckedAt || integration?.lastValidatedAt)}
          </p>
        </div>
      ) : null}

      {integration?.validationMessage ? (
        <p className={state === "connected" ? "success-copy" : "table-subtle"}>{integration.validationMessage}</p>
      ) : null}

      {state === "connected" && details?.account ? (
        <dl className="detail-list provider-success-details">
          <div>
            <dt>Account</dt>
            <dd>{details.account.name || "Verified"}</dd>
          </div>
          {details.account.mode ? (
            <div>
              <dt>Mode</dt>
              <dd>{details.account.mode === "test" ? "Test" : "Live"}</dd>
            </div>
          ) : null}
          {details.account.apiVersion ? (
            <div>
              <dt>API version</dt>
              <dd>{details.account.apiVersion}</dd>
            </div>
          ) : null}
          {details.webhook ? (
            <div>
              <dt>Webhook</dt>
              <dd>{details.webhook.verified ? "Verified" : details.webhook.configured ? "Configured" : "Not configured"}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div className="channel-actions provider-dashboard__actions">
        <button
          type="button"
          className="primary-button"
          onClick={onValidate}
          disabled={disableActions || validating}
        >
          {validating ? "Validating..." : "Validate connection"}
        </button>
        {onDisconnect ? (
          <button
            type="button"
            className="secondary-button danger-button"
            onClick={onDisconnect}
            disabled={disableActions || validating}
          >
            Disconnect
          </button>
        ) : null}
      </div>
    </PageSection>
  );
};

export const connectionToneClass = (state: ConnectionUiState): string => connectionStateMeta[state].tone;
