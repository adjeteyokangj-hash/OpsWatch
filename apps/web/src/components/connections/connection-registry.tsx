"use client";

import {
  authTypeLabel,
  connectionProductStatus,
  configurationString,
  formatLatency,
  hostFromBaseUrl,
  isMonitoringMethod,
  methodLabel,
  modeToMethod
} from "./connection-form-state";
import {
  credentialStatusLabel,
  credentialStatusPillClass,
  deriveConnectionCredentialStatus,
  formatCredentialDate,
  formatCredentialDateOrNever,
  maskedSecretConfiguredLabel
} from "../../lib/credential-status";
import type { ConnectionRecord } from "./types";
import { EmptyState } from "../ui/empty-state";
import { formatRelativeTime } from "../../lib/relative-time";
import { useState } from "react";

type ConnectionRegistryProps = {
  connections: ConnectionRecord[];
  loading: boolean;
  busyId: string | null;
  /** When false, admin-only actions are hidden. Null = role unknown — show actions. */
  isAdmin?: boolean | null;
  onAdd: () => void;
  onTest: (connectionId: string) => void;
  onSync?: (connectionId: string) => void;
  onEdit: (connection: ConnectionRecord) => void;
  onDisable: (connection: ConnectionRecord) => void;
  onRotate: (connection: ConnectionRecord, authSecret: string) => void;
  onDelete: (connection: ConnectionRecord) => void;
};

export function ConnectionRegistry({
  connections,
  loading,
  busyId,
  isAdmin = null,
  onAdd,
  onTest,
  onSync,
  onEdit,
  onDisable,
  onRotate,
  onDelete
}: ConnectionRegistryProps) {
  const [rotateId, setRotateId] = useState<string | null>(null);
  const [rotateSecret, setRotateSecret] = useState("");
  const [showRotateSecret, setShowRotateSecret] = useState(false);

  const showAdminActions = isAdmin !== false;

  const submitRotate = (connection: ConnectionRecord) => {
    if (!rotateSecret.trim()) return;
    onRotate(connection, rotateSecret.trim());
    setRotateSecret("");
    setRotateId(null);
    setShowRotateSecret(false);
  };

  return (
    <section className="panel" aria-label="Connection registry">
      <div className="panel-heading-row">
        <div>
          <h2>Connection registry</h2>
          <p className="dashboard-subtle">Live connection status without secrets or raw credential references.</p>
        </div>
      </div>
      {loading ? (
        <p aria-busy="true">Loading connections…</p>
      ) : connections.length === 0 ? (
        <EmptyState
          title="No connections configured"
          description="Add a guided connection to begin monitoring an application endpoint."
          action={
            <button type="button" className="primary-button" onClick={onAdd}>
              Add connection
            </button>
          }
        />
      ) : (
        <div className="table-cards-wrap">
          <table className="data-table connection-registry-table" data-testid="connection-registry-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Credential</th>
                <th>Auth</th>
                <th>Env</th>
                <th>Created</th>
                <th>Expires</th>
                <th>Last used</th>
                <th>Last tested</th>
                <th>Last sync</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((connection) => {
                const method = modeToMethod(connection.connectorType || connection.mode);
                const productStatus = connectionProductStatus(connection.connectorType || connection.mode);
                const credentialStatus = deriveConnectionCredentialStatus(connection);
                const rotating = rotateId === connection.id;
                const credentialEnv = connection.credentialEnvironment ?? connection.environment;
                const credentialType =
                  connection.credentialType ??
                  (connection.authMethod && connection.authMethod !== "NONE" ? connection.authMethod : "—");
                const rotationLabel =
                  credentialStatus === "ROTATION_PENDING"
                    ? "Rotation pending"
                    : connection.credentialLastRotatedAt
                      ? formatCredentialDate(connection.credentialLastRotatedAt)
                      : connection.credentialVersion != null
                        ? `v${connection.credentialVersion}`
                        : "—";

                return (
                  <tr key={connection.id} data-testid={`connection-row-${connection.id}`}>
                    <td data-label="Name">
                      {connection.name}
                      <small>{methodLabel(method)}</small>
                      <small data-testid={`connection-product-status-${connection.id}`}>
                        Catalogue: {productStatus}
                      </small>
                    </td>
                    <td data-label="Credential">
                      <span
                        className={`result-pill ${connection.secretConfigured ? "pass" : "neutral"}`}
                        data-testid={`connection-credential-mask-${connection.id}`}
                      >
                        {maskedSecretConfiguredLabel(Boolean(connection.secretConfigured))}
                      </span>
                      <small>{rotationLabel !== "—" ? `Rotation: ${rotationLabel}` : null}</small>
                    </td>
                    <td data-label="Auth">{authTypeLabel(connection.authMethod) || credentialType}</td>
                    <td data-label="Env">{credentialEnv}</td>
                    <td data-label="Created">{formatCredentialDate(connection.createdAt)}</td>
                    <td data-label="Expires">{formatCredentialDate(connection.credentialExpiresAt)}</td>
                    <td data-label="Last used">{formatCredentialDateOrNever(connection.lastSuccessAt)}</td>
                    <td data-label="Last tested">{formatCredentialDateOrNever(connection.lastValidatedAt)}</td>
                    <td data-label="Last sync">
                      {isMonitoringMethod(method) ? (
                        <>
                          <span data-testid={`connection-last-sync-${connection.id}`}>
                            {connection.lastSyncStatus ?? "Not synced"}
                          </span>
                          <small>{formatCredentialDateOrNever(connection.lastSyncAt)}</small>
                          {connection.lastSyncSummary ? <small>{connection.lastSyncSummary}</small> : null}
                        </>
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                    <td data-label="Status">
                      <span
                        className={`result-pill ${credentialStatusPillClass(credentialStatus)}`}
                        data-testid={`connection-credential-status-${connection.id}`}
                      >
                        {credentialStatusLabel(credentialStatus)}
                      </span>
                      {!connection.isActive ? (
                        <small>Disabled</small>
                      ) : connection.health ? (
                        <small>{connection.health}</small>
                      ) : null}
                    </td>
                    <td data-label="Actions">
                      <div className="connection-registry-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={busyId === connection.id || !connection.isActive}
                          onClick={() => onTest(connection.id)}
                        >
                          {busyId === connection.id ? "Working…" : "Test"}
                        </button>
                        {isMonitoringMethod(method) && onSync ? (
                          <button
                            type="button"
                            className="secondary-button"
                            data-testid={`connection-sync-button-${connection.id}`}
                            disabled={busyId === connection.id || !connection.isActive}
                            onClick={() => onSync(connection.id)}
                          >
                            Sync
                          </button>
                        ) : null}
                        <button type="button" className="secondary-button" onClick={() => onEdit(connection)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={busyId === connection.id}
                          onClick={() => onDisable(connection)}
                        >
                          {connection.isActive ? "Disable" : "Enable"}
                        </button>
                        {showAdminActions ? (
                          <button
                            type="button"
                            className="secondary-button"
                            data-testid={`connection-rotate-button-${connection.id}`}
                            disabled={busyId === connection.id || !connection.secretConfigured}
                            onClick={() => {
                              setRotateId(connection.id);
                              setRotateSecret("");
                            }}
                          >
                            Rotate
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={busyId === connection.id}
                          onClick={() => onDelete(connection)}
                        >
                          Delete
                        </button>
                      </div>
                      {rotating ? (
                        <div className="connection-rotate-inline" data-testid={`connection-rotate-${connection.id}`}>
                          <label>
                            New secret
                            <input
                              type={showRotateSecret ? "text" : "password"}
                              autoComplete="new-password"
                              value={rotateSecret}
                              onChange={(event) => setRotateSecret(event.target.value)}
                            />
                          </label>
                          <div className="connection-secret-field__actions">
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => setShowRotateSecret((value) => !value)}
                            >
                              {showRotateSecret ? "Hide" : "Show"}
                            </button>
                            <button
                              type="button"
                              className="primary-button"
                              disabled={!rotateSecret.trim()}
                              onClick={() => submitRotate(connection)}
                            >
                              Save secret
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => {
                                setRotateId(null);
                                setRotateSecret("");
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
                      <span className="sr-only">
                        {hostFromBaseUrl(
                          connection.baseUrl || configurationString(connection.configuration, "baseUrl")
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
