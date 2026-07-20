"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { EmptyState } from "../../../../components/ui/empty-state";
import { PageSection } from "../../../../components/ui/page-section";
import { ProductTruthStatus } from "../../../../components/ui/product-truth-status";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";
import { apiFetch } from "../../../../lib/api";

type ApmOverview = {
  state: string;
  message?: string;
  productLabel?: string;
  activeIncidents?: number;
  services: Array<{
    serviceName: string;
    health: string;
    requestCount: number;
    errorRate: number;
    latencyP95Ms: number | null;
    sampleCount: number;
    freshness: string;
    percentileNote: string | null;
    entityId: string | null;
  }>;
  endpoints: Array<{
    serviceName: string;
    operation: string;
    requestCount: number;
    errorRate: number;
    latencyP95Ms: number | null;
    sampleCount: number;
    percentileNote: string | null;
  }>;
  dependencies: Array<{
    sourceServiceName: string;
    targetServiceName: string;
    requestCount: number;
    errorRate: number;
    timeoutRate: number;
    latencyP95Ms: number | null;
    health: string;
    freshness: string;
    relationshipId: string | null;
  }>;
  failingTraces: Array<{
    traceId: string;
    status: string;
    durationMs: number | null;
    isPartial: boolean;
    rootServiceName: string | null;
  }>;
};

type TraceEvidence = {
  traceId: string;
  isPartial: boolean;
  warning: string | null;
  totalDurationMs: number | null;
  failingSpanId: string | null;
  status: string;
  serviceSequence: string[];
  spans: Array<{
    spanId: string;
    parentSpanId: string | null;
    operationName: string;
    durationMs: number | null;
    status: string;
  }>;
  relatedLogs: Array<{ id: string; severity: string | null; message: string | null }>;
  relatedAlertIds: string[];
  relatedIncidentIds: string[];
};

export function ProjectPerformancePageInner() {
  const { projectId } = useParams<{ projectId: string }>();
  const searchParams = useSearchParams();
  const { project, loading, error } = useProjectWorkspace(projectId);
  const [environment, setEnvironment] = useState("");
  const [overview, setOverview] = useState<ApmOverview | null>(null);
  const [trace, setTrace] = useState<TraceEvidence | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const traceId = searchParams.get("traceId");

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (environment) params.set("environment", environment);
      params.set("windowSize", "5m");
      const next = await apiFetch<ApmOverview>(
        `/projects/${projectId}/apm/overview?${params.toString()}`
      );
      setOverview(next);
      if (traceId) {
        const evidence = await apiFetch<TraceEvidence>(
          `/projects/${projectId}/traces/${traceId}`
        );
        setTrace(evidence);
      } else {
        setTrace(null);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load APM");
    }
  }, [projectId, environment, traceId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title="Performance"
      subtitle="Application performance foundation — evidence-based latency, throughput, and errors."
      project={project}
      loading={loading}
      error={error}
    >
      <PageSection
        title="Application performance"
        description="Service, endpoint, and dependency summaries from retained spans. Percentiles are withheld when sample volume is insufficient."
        persistKey={`project:${projectId}:performance:apm`}
        data-testid="apm-performance"
        actions={<ProductTruthStatus state="Foundation" />}
      >
        <label>
          Environment
          <input
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            placeholder="production"
            data-testid="apm-filter-environment"
          />
        </label>

        {loadError && <p className="form-error">{loadError}</p>}

        {overview?.state === "FEATURE_DISABLED" && (
          <EmptyState
            title="APM UI disabled"
            description={
              overview.message ??
              "Enable OPSWATCH_APM_UI_ENABLED and TRACE_APM processing after connecting OTEL."
            }
            action={
              <Link className="primary-button" href={`/integrations/${projectId}`}>
                Review integrations
              </Link>
            }
          />
        )}

        {overview?.state === "OK" && (
          <>
            <p className="dashboard-subtle" data-testid="apm-active-incidents">
              Active incidents: {overview.activeIncidents ?? 0}
            </p>

            <h3>Services</h3>
            {overview.services.length === 0 ? (
              <EmptyState
                title="No service APM samples"
                description="No retained span windows yet. Data is not invented when samples are unavailable."
              />
            ) : (
              <div className="table-wrap" data-testid="apm-services">
                <table>
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>Health</th>
                      <th>Requests</th>
                      <th>Error rate</th>
                      <th>p95</th>
                      <th>Freshness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.services.map((svc) => (
                      <tr key={`${svc.serviceName}-${svc.entityId ?? "x"}`}>
                        <td>
                          {svc.entityId ? (
                            <Link href={`/projects/${projectId}/topology?entityId=${svc.entityId}`}>
                              {svc.serviceName}
                            </Link>
                          ) : (
                            svc.serviceName
                          )}
                        </td>
                        <td>{svc.health}</td>
                        <td>{svc.requestCount}</td>
                        <td>{(svc.errorRate * 100).toFixed(1)}%</td>
                        <td>
                          {svc.latencyP95Ms != null ? `${Math.round(svc.latencyP95Ms)}ms` : "—"}
                          {svc.percentileNote ? ` (${svc.percentileNote})` : ""}
                        </td>
                        <td>{svc.freshness}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h3>Endpoints</h3>
            <div className="table-wrap" data-testid="apm-endpoints">
              <table>
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Operation</th>
                    <th>Requests</th>
                    <th>Error rate</th>
                    <th>p95</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.endpoints.map((ep) => (
                    <tr key={`${ep.serviceName}-${ep.operation}`}>
                      <td>{ep.serviceName}</td>
                      <td>{ep.operation}</td>
                      <td>{ep.requestCount}</td>
                      <td>{(ep.errorRate * 100).toFixed(1)}%</td>
                      <td>
                        {ep.latencyP95Ms != null ? `${Math.round(ep.latencyP95Ms)}ms` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3>Dependencies</h3>
            <div className="table-wrap" data-testid="apm-dependencies">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Target</th>
                    <th>Health</th>
                    <th>Error rate</th>
                    <th>Timeout rate</th>
                    <th>p95</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.dependencies.map((dep) => (
                    <tr key={`${dep.sourceServiceName}-${dep.targetServiceName}`}>
                      <td>{dep.sourceServiceName}</td>
                      <td>
                        {dep.relationshipId ? (
                          <Link
                            href={`/projects/${projectId}/topology?relationshipId=${dep.relationshipId}`}
                          >
                            {dep.targetServiceName}
                          </Link>
                        ) : (
                          dep.targetServiceName
                        )}
                      </td>
                      <td>{dep.health}</td>
                      <td>{(dep.errorRate * 100).toFixed(1)}%</td>
                      <td>{(dep.timeoutRate * 100).toFixed(1)}%</td>
                      <td>
                        {dep.latencyP95Ms != null ? `${Math.round(dep.latencyP95Ms)}ms` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3>Recent failing traces</h3>
            <ul data-testid="apm-failing-traces">
              {overview.failingTraces.map((t) => (
                <li key={t.traceId}>
                  <Link href={`/projects/${projectId}/performance?traceId=${t.traceId}`}>
                    {t.traceId.slice(0, 16)}…
                  </Link>{" "}
                  {t.rootServiceName ?? ""} {t.isPartial ? "(partial)" : ""}{" "}
                  {t.durationMs != null ? `${t.durationMs}ms` : ""}
                </li>
              ))}
            </ul>
          </>
        )}
      </PageSection>

      {trace && (
        <PageSection
          title="Trace evidence"
          description="Span sequence and correlation for the selected trace."
          persistKey={`project:${projectId}:performance:trace`}
          data-testid="trace-evidence"
        >
          {trace.warning && <p className="form-error">{trace.warning}</p>}
          <p>
            Status {trace.status} · duration {trace.totalDurationMs ?? "—"}ms · services{" "}
            {trace.serviceSequence.join(" → ")}
          </p>
          <p>
            Related alerts: {trace.relatedAlertIds.length} · incidents:{" "}
            {trace.relatedIncidentIds.length} · logs: {trace.relatedLogs.length}
          </p>
          <ul>
            {trace.spans.map((span) => (
              <li key={span.spanId} style={{ paddingLeft: span.parentSpanId ? 16 : 0 }}>
                {span.operationName} · {span.status} · {span.durationMs ?? "—"}ms
                {trace.failingSpanId === span.spanId ? " ← failing" : ""}
              </li>
            ))}
          </ul>
        </PageSection>
      )}
    </ProjectWorkspaceShell>
  );
}
