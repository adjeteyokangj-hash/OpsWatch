"use client";

import { useState } from "react";
import { formatRelativeTime } from "../../lib/relative-time";
import { EmptyState } from "../ui/empty-state";
import {
  authTypeLabel,
  configurationString,
  formatLatency,
  hostFromBaseUrl,
  methodLabel,
  modeToMethod
} from "./connection-form-state";
import type { ConnectionRecord } from "./types";

type ConnectionRegistryProps = {
  connections: ConnectionRecord[];
  loading: boolean;
  busyId: string | null;
  onAdd: () => void;
  onTest: (connectionId: string) => void;
  onEdit: (connection: ConnectionRecord) => void;
  onDisable: (connection: ConnectionRecord) => void;
  onRotate: (connection: ConnectionRecord, authSecret: string) => void;
  onDelete: (connection: ConnectionRecord) => void;
};

export function ConnectionRegistry({
  connections,
  loading,
  busyId,
  onAdd,
  onTest,
  onEdit,
  onDisable,
  onRotate,
  onDelete
}: ConnectionRegistryProps) {
  const [rotateId, setRotateId] = useState<string | null>(null);
  const [rotateSecret, setRotateSecret] = useState("");
  const [showRotateSecret, setShowRotateSecret] = useState(false);

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
          <table className="data-table connection-registry-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>App</th>
                <th>Env</th>
                <th>Method</th>
                <th>Status</th>
                <th>Last check</th>
                <th>Latency</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((connection) => {
                const method = modeToMethod(connection.connectorType || connection.mode);
                const lastCheck =
                  connection.lastValidatedAt || connection.lastSuccessAt || connection.lastFailureAt || null;
                const rotating = rotateId === connection.id;
                return (
                  <tr key={connection.id}>
                    <td data-label="Name">
                      {connection.name}
                      <small>
                        {authTypeLabel(connection.authMethod)}
                        {connection.secretConfigured ? " · secret configured" : ""}
                      </small>
                    </td>
                    <td data-label="App">{connection.project?.name ?? "—"}</td>
                    <td data-label="Env">{connection.environment}</td>
                    <td data-label="Method">{methodLabel(method)}</td>
                    <td data-label="Status">
                      {connection.isActive ? connection.health || connection.installationStatus || "—" : "DISABLED"}
                    </td>
                    <td data-label="Last check">{formatRelativeTime(lastCheck)}</td>
                    <td data-label="Latency">{formatLatency(connection.validationLatencyMs)}</td>
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
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            setRotateId(connection.id);
                            setRotateSecret("");
                          }}
                        >
                          Rotate
                        </button>
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
                      {/* Keep host available for accessibility without exposing secrets */}
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
