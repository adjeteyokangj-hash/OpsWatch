"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../lib/api";
import { formatRelativeTime } from "../../lib/relative-time";
import {
  authTypeLabel,
  configurationString,
  formatLatency,
  hostFromBaseUrl,
  methodLabel,
  modeToMethod
} from "./connection-form-state";
import type { ConnectionRecord } from "./types";

type ProjectConnectionsSectionProps = {
  projectId: string;
};

export function ProjectConnectionsSection({ projectId }: ProjectConnectionsSectionProps) {
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<ConnectionRecord[]>(`/connections?projectId=${encodeURIComponent(projectId)}`)
      .then((rows) => {
        if (!cancelled) setConnections(Array.isArray(rows) ? rows : []);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load connections");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <section className="panel project-connections-section" aria-label="Connections" data-testid="project-connections-section">
      <div className="panel-heading-row">
        <div>
          <h2>Connections</h2>
          <p className="dashboard-subtle">Project-scoped operational connections. Secrets and raw credential references stay off this page.</p>
        </div>
        <Link className="secondary-button" href={`/connections?projectId=${encodeURIComponent(projectId)}`}>
          Manage connections
        </Link>
      </div>
      {error ? (
        <p className="error-panel" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p aria-busy="true">Loading connections…</p>
      ) : connections.length === 0 ? (
        <p className="dashboard-subtle">No connections for this application yet.</p>
      ) : (
        <div className="table-cards-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Env</th>
                <th>Method</th>
                <th>Host</th>
                <th>Auth</th>
                <th>Last checked</th>
                <th>Latency</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((connection) => {
                const method = modeToMethod(connection.connectorType || connection.mode);
                const baseUrl =
                  connection.baseUrl || configurationString(connection.configuration, "baseUrl");
                const lastCheck =
                  connection.lastValidatedAt || connection.lastSuccessAt || connection.lastFailureAt || null;
                return (
                  <tr key={connection.id}>
                    <td data-label="Name">{connection.name}</td>
                    <td data-label="Status">
                      {connection.isActive ? connection.health || "—" : "DISABLED"}
                    </td>
                    <td data-label="Env">{connection.environment}</td>
                    <td data-label="Method">{methodLabel(method)}</td>
                    <td data-label="Host">{hostFromBaseUrl(baseUrl)}</td>
                    <td data-label="Auth">{authTypeLabel(connection.authMethod)}</td>
                    <td data-label="Last checked">{formatRelativeTime(lastCheck)}</td>
                    <td data-label="Latency">{formatLatency(connection.validationLatencyMs)}</td>
                    <td data-label="Actions">
                      <Link
                        className="secondary-button"
                        href={`/connections?projectId=${encodeURIComponent(projectId)}`}
                      >
                        Open
                      </Link>
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
