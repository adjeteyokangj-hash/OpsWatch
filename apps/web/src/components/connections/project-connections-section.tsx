"use client";

import { useCallback, useEffect, useState } from "react";
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
import {
  MonitoringDepthSummary,
  type MonitoringSetup
} from "../projects/monitoring-depth-summary";
import { PageSection } from "../ui/page-section";

type ProjectConnectionsSectionProps = {
  projectId: string;
};

type ProjectMonitoring = {
  frontendUrl?: string | null;
  adminUrl?: string | null;
  monitoringSetup?: MonitoringSetup;
};

export function ProjectConnectionsSection({ projectId }: ProjectConnectionsSectionProps) {
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [projectMonitoring, setProjectMonitoring] = useState<ProjectMonitoring | null>(null);
  const [publicUrl, setPublicUrl] = useState("");
  const [adminUrl, setAdminUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cancelled?: () => boolean) => {
    const [connectionRows, project] = await Promise.all([
      apiFetch<ConnectionRecord[]>(`/connections?projectId=${encodeURIComponent(projectId)}`),
      apiFetch<ProjectMonitoring>(`/projects/${encodeURIComponent(projectId)}`)
    ]);
    if (cancelled?.()) return;
    setConnections(Array.isArray(connectionRows) ? connectionRows : []);
    setProjectMonitoring(project);
    setPublicUrl(project.frontendUrl ?? "");
    setAdminUrl(project.adminUrl ?? "");
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    load(() => cancelled)
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
  }, [load]);

  const saveUrlMonitoring = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          frontendUrl: publicUrl.trim() || null,
          adminUrl: adminUrl.trim() || null
        })
      });
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to configure URL monitoring");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageSection
      title="Connections"
      description="Project-scoped operational connections. Secrets and raw credential references stay off this page."
      persistKey={`project:${projectId}:monitoring-connections`}
      className="project-connections-section"
      data-testid="project-connections-section"
      actions={
        <Link className="secondary-button" href={`/connections?projectId=${encodeURIComponent(projectId)}`}>
          Manage connections
        </Link>
      }
    >
      {error ? (
        <p className="error-panel" role="alert">
          {error}
        </p>
      ) : null}
      <div className="stack-form monitoring-url-form">
        <div className="form-grid">
          <label>
            Public website URL
            <input
              type="url"
              value={publicUrl}
              onChange={(event) => setPublicUrl(event.target.value)}
              placeholder="https://www.example.com"
            />
          </label>
          <label>
            Admin URL (optional, unauthenticated checks only)
            <input
              type="url"
              value={adminUrl}
              onChange={(event) => setAdminUrl(event.target.value)}
              placeholder="https://admin.example.com"
            />
          </label>
        </div>
        <div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void saveUrlMonitoring()}
            disabled={saving}
            data-action="api"
          >
            {saving ? "Setting up monitoring…" : "Save URL monitoring"}
          </button>
        </div>
        <p className="dashboard-subtle">
          Safe reachability, redirect, response-time, HTTP status, and TLS checks only. Never enter administrator credentials in a URL.
        </p>
      </div>
      {projectMonitoring?.monitoringSetup ? (
        <MonitoringDepthSummary
          setup={projectMonitoring.monitoringSetup}
          onRetry={() => void saveUrlMonitoring()}
          retrying={saving}
        />
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
    </PageSection>
  );
}
