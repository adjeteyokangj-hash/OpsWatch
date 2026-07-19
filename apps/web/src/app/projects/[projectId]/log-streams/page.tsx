"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, Fragment, useCallback, useEffect, useState } from "react";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { EmptyState } from "../../../../components/ui/empty-state";
import { ProductTruthStatus } from "../../../../components/ui/product-truth-status";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";
import { apiFetch } from "../../../../lib/api";

type LogRow = {
  id: string;
  timestamp: string;
  severity: string | null;
  serviceName: string | null;
  environment: string;
  message: string | null;
  occurrenceCount: number;
  hasTrace: boolean;
  traceId: string | null;
  relatedAlertIds: string[];
  relatedIncidentIds: string[];
  fingerprint: string;
};

type LogsResponse = {
  state: string;
  message?: string;
  items: LogRow[];
  nextCursor: string | null;
};

type StatusResponse = {
  connectionState: string;
  flags: {
    logsIngestion: boolean;
    logsExplorer: boolean;
    traceApmProcessing: boolean;
    apmUi: boolean;
  };
  logCount: number;
  productLabel: string;
};

export default function ProjectLogsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, loading, error } = useProjectWorkspace(projectId);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [result, setResult] = useState<LogsResponse | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [environment, setEnvironment] = useState("");
  const [severity, setSeverity] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const next = await apiFetch<StatusResponse>(`/projects/${projectId}/logs/status`);
      setStatus(next);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : "Failed to load logs status");
    }
  }, [projectId]);

  const runSearch = useCallback(async () => {
    setQueryError(null);
    try {
      const params = new URLSearchParams();
      if (environment) params.set("environment", environment);
      if (severity) params.set("severity", severity);
      if (serviceName) params.set("serviceName", serviceName);
      if (text) params.set("text", text);
      params.set("limit", "50");
      const next = await apiFetch<LogsResponse>(
        `/projects/${projectId}/logs?${params.toString()}`
      );
      setResult(next);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : "Log search failed");
    }
  }, [projectId, environment, severity, serviceName, text]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (status?.flags.logsExplorer) void runSearch();
  }, [status?.flags.logsExplorer, runSearch]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void runSearch();
  };

  const explorerEnabled = Boolean(status?.flags.logsExplorer);
  const notConnected = status?.connectionState === "NOT_CONNECTED";

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title="Logs"
      subtitle="Searchable operational logs — Foundation."
      project={project}
      loading={loading}
      error={error}
    >
      <section className="panel" data-testid="logs-explorer">
        <div className="panel-heading-row">
          <div>
            <h2>Logs explorer</h2>
            <p className="dashboard-subtle">
              Retained OTEL log records with redaction, grouping, and alert/incident correlation.
              Retention and supported formats follow the current plan and OTEL bridge.
            </p>
          </div>
          <ProductTruthStatus state="Foundation" />
        </div>

        <p className="dashboard-subtle" data-testid="logs-connection-state">
          Connection: {status?.connectionState ?? "…"} · Ingestion{" "}
          {status?.flags.logsIngestion ? "enabled" : "disabled"} · Explorer{" "}
          {status?.flags.logsExplorer ? "enabled" : "disabled"}
        </p>

        {!explorerEnabled && (
          <EmptyState
            title="Logs explorer disabled"
            description="Enable OPSWATCH_LOGS_EXPLORER_ENABLED and connect an OTEL collector to search retained log records. This is not a live stream counter."
            action={
              <Link className="primary-button" href={`/integrations/${projectId}`}>
                Review integrations
              </Link>
            }
          />
        )}

        {explorerEnabled && notConnected && (
          <EmptyState
            title="Not connected"
            description="No active OTEL collector connection is supplying log evidence for this application. Configure log forwarding to begin retaining searchable records."
            action={
              <Link className="primary-button" href={`/integrations/${projectId}`}>
                Connect OTEL
              </Link>
            }
          />
        )}

        {explorerEnabled && (
          <form className="stack-form" onSubmit={onSubmit} data-testid="logs-search-form">
            <div className="form-grid">
              <label>
                Environment
                <input
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value)}
                  placeholder="production"
                  data-testid="logs-filter-environment"
                />
              </label>
              <label>
                Severity
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  data-testid="logs-filter-severity"
                >
                  <option value="">Any</option>
                  <option value="INFO">INFO</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HIGH">HIGH</option>
                  <option value="CRITICAL">CRITICAL</option>
                </select>
              </label>
              <label>
                Service
                <input
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  placeholder="checkout-api"
                  data-testid="logs-filter-service"
                />
              </label>
              <label>
                Text search
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="exception message"
                  data-testid="logs-filter-text"
                />
              </label>
            </div>
            <button type="submit" className="primary-button" data-testid="logs-search-submit">
              Search
            </button>
          </form>
        )}

        {queryError && <p className="form-error">{queryError}</p>}

        {result?.state === "FEATURE_DISABLED" && (
          <p className="dashboard-subtle">{result.message}</p>
        )}

        {result?.state === "OK" && result.items.length === 0 && (
          <EmptyState
            title="No log records in range"
            description="No retained log records matched these filters. This page does not invent stream counts or seeded trends."
          />
        )}

        {result?.state === "OK" && result.items.length > 0 && (
          <div className="table-wrap" data-testid="logs-results">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Service</th>
                  <th>Severity</th>
                  <th>Message</th>
                  <th>Count</th>
                  <th>Corr</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((row) => (
                  <Fragment key={row.id}>
                    <tr
                      data-testid="logs-result-row"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      <td>{new Date(row.timestamp).toLocaleString()}</td>
                      <td>{row.serviceName ?? "—"}</td>
                      <td>{row.severity ?? "—"}</td>
                      <td>{row.message ?? "—"}</td>
                      <td>{row.occurrenceCount}</td>
                      <td>
                        {row.hasTrace ? "trace" : ""}
                        {row.relatedAlertIds.length ? " alert" : ""}
                        {row.relatedIncidentIds.length ? " incident" : ""}
                      </td>
                    </tr>
                    {expanded === row.id && (
                      <tr data-testid="logs-result-details">
                        <td colSpan={6}>
                          <pre className="code-block">{JSON.stringify(row, null, 2)}</pre>
                          {row.traceId && (
                            <Link href={`/projects/${projectId}/performance?traceId=${row.traceId}`}>
                              Open related trace
                            </Link>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </ProjectWorkspaceShell>
  );
}
