"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { HealthBadge } from "../health/health-badge";
import { EmptyState } from "../ui/empty-state";
import { PageSection } from "../ui/page-section";
import { EditServiceForm } from "./edit-service-form";
import { ProjectWorkspaceShell } from "./project-workspace-shell";
import { useProjectWorkspace } from "../../hooks/use-project-workspace";
import { apiFetch } from "../../lib/api";
import { formatRelativeTime } from "../../lib/relative-time";

type CheckRow = {
  id: string;
  name: string;
  type?: string;
  latestResult?: { status: string; checkedAt: string } | null;
};

type CheckListResponse = {
  items: CheckRow[];
  summary?: { total: number; pass: number; fail: number; warn: number; pending: number };
};

type AlertRow = {
  id: string;
  title: string;
  severity: string;
  status: string;
  serviceId?: string | null;
};

const normalizeChecks = (response: CheckListResponse | CheckRow[]): CheckRow[] =>
  Array.isArray(response) ? response : response.items ?? [];

const checkStatusTone = (status: string): string => {
  if (status === "PASS") return "HEALTHY";
  if (status === "FAIL") return "DOWN";
  if (status === "WARN") return "DEGRADED";
  return "UNKNOWN";
};

const criticalityLabel = (service: { isCritical?: boolean; criticality?: string | null }): string => {
  if (service.isCritical) return "Critical";
  if (service.criticality) return String(service.criticality);
  return "Standard";
};

const isOpenAlert = (status: string): boolean => status === "OPEN" || status === "ACKNOWLEDGED";

export function ModuleDetailPage() {
  const { projectId, serviceId } = useParams<{ projectId: string; serviceId: string }>();
  const { project, loading: projectLoading, error: projectError, reload } = useProjectWorkspace(projectId);
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const [checksLoading, setChecksLoading] = useState(true);
  const [checksError, setChecksError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const service = useMemo(
    () => (project?.services ?? []).find((row: { id: string }) => row.id === serviceId) ?? null,
    [project, serviceId]
  );

  const openAlerts = useMemo(() => {
    const alerts = (project?.alerts ?? []) as AlertRow[];
    return alerts.filter((alert) => alert.serviceId === serviceId && isOpenAlert(alert.status));
  }, [project, serviceId]);

  const latestCheck = useMemo(() => {
    const withResult = checks
      .filter((row) => row.latestResult?.checkedAt)
      .sort(
        (a, b) =>
          new Date(b.latestResult!.checkedAt).getTime() - new Date(a.latestResult!.checkedAt).getTime()
      );
    return withResult[0] ?? null;
  }, [checks]);

  useEffect(() => {
    if (!projectId || !serviceId) return;
    const load = async () => {
      setChecksLoading(true);
      setChecksError(null);
      try {
        const response = await apiFetch<CheckListResponse | CheckRow[]>(
          `/checks?projectId=${projectId}&serviceId=${serviceId}`
        );
        setChecks(normalizeChecks(response));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to load checks";
        setChecksError(message);
        setChecks([]);
      } finally {
        setChecksLoading(false);
      }
    };
    void load();
  }, [projectId, serviceId]);

  const addCheckHref = `/checks?projectId=${projectId}&serviceId=${serviceId}`;
  const checksHref = addCheckHref;
  const topologyHref = `/projects/${projectId}/topology`;
  const modulesHref = `/projects/${projectId}/modules`;
  const alertsHref = `/alerts?projectId=${projectId}&serviceId=${serviceId}`;

  const title = service?.name ?? "Module";
  const notFound = !projectLoading && project && !service;

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title={title}
      subtitle={
        service
          ? "Module overview — health, checks, and open alerts for this service."
          : "Module overview"
      }
      breadcrumbLabel={service?.name ?? "Module"}
      project={project}
      loading={projectLoading}
      error={projectError ?? checksError}
      actions={
        service ? (
          <>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setEditing((value) => !value)}
              data-action="local-ui"
            >
              {editing ? "Cancel edit" : "Edit module"}
            </button>
            <Link href={topologyHref} className="secondary-button">
              View topology
            </Link>
            <Link href={checksHref} className="primary-button">
              View checks
            </Link>
          </>
        ) : null
      }
    >
      {projectLoading ? (
        <section className="panel workspace-loading">
          <div className="loading-pulse" />
          <p>Loading module…</p>
        </section>
      ) : null}

      {notFound ? (
        <EmptyState
          title="Module not found"
          description="This module is not part of the selected application, or it was removed."
          action={
            <Link href={modulesHref} className="primary-button">
              Back to modules
            </Link>
          }
        />
      ) : null}

      {service ? (
        <>
          {editing ? (
            <section className="panel workspace-section-card">
              <EditServiceForm
                serviceId={service.id}
                name={service.name}
                baseUrl={service.baseUrl}
                onCancel={() => setEditing(false)}
                onUpdated={() => {
                  setEditing(false);
                  void reload();
                }}
              />
            </section>
          ) : null}

          <PageSection
            title="Overview"
            description="Registered module details from this application’s inventory."
            className="workspace-section-card"
            aria-label="Module overview"
            persistKey={`project:${projectId}:module:${serviceId}:overview`}
            actions={<HealthBadge status={service.status} />}
          >
            <dl className="topology-detail-grid module-detail-grid">
              <div>
                <dt>Name</dt>
                <dd>{service.name}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{service.type}</dd>
              </div>
              <div>
                <dt>Criticality</dt>
                <dd>
                  {service.isCritical ? (
                    <span className="criticality-tag">{criticalityLabel(service)}</span>
                  ) : (
                    criticalityLabel(service)
                  )}
                </dd>
              </div>
              <div>
                <dt>Health</dt>
                <dd>
                  <HealthBadge status={service.status} />
                </dd>
              </div>
              <div>
                <dt>Target URL</dt>
                <dd>{service.baseUrl || "No target URL"}</dd>
              </div>
              <div>
                <dt>Last check</dt>
                <dd>
                  {latestCheck?.latestResult ? (
                    <>
                      {formatRelativeTime(latestCheck.latestResult.checkedAt)}
                      {" · "}
                      <HealthBadge
                        status={checkStatusTone(latestCheck.latestResult.status)}
                        displayLabel={latestCheck.latestResult.status}
                      />
                    </>
                  ) : checksLoading ? (
                    "…"
                  ) : (
                    "No checks run yet"
                  )}
                </dd>
              </div>
              <div>
                <dt>Open alerts</dt>
                <dd>
                  {openAlerts.length === 0 ? (
                    "None"
                  ) : (
                    <Link href={alertsHref} className="text-link">
                      {openAlerts.length} open
                    </Link>
                  )}
                </dd>
              </div>
            </dl>
            <p className="dashboard-subtle" style={{ marginTop: "1rem", marginBottom: 0 }}>
              <Link href={modulesHref} className="text-link">
                ← All modules
              </Link>
              {" · "}
              <Link href={topologyHref} className="text-link">
                Topology
              </Link>
              {" · "}
              <Link href={checksHref} className="text-link">
                Checks console
              </Link>
            </p>
          </PageSection>

          <PageSection
            title="Open alerts"
            description="Unresolved alerts linked to this module."
            className="workspace-section-card"
            aria-label="Open alerts"
            persistKey={`project:${projectId}:module:${serviceId}:alerts`}
            actions={
              openAlerts.length > 0 ? (
                <Link href={alertsHref} className="text-link">
                  View all →
                </Link>
              ) : null
            }
          >
            {openAlerts.length === 0 ? (
              <p className="dashboard-subtle">No open alerts for this module.</p>
            ) : (
              <ul className="topology-alert-list">
                {openAlerts.map((alert) => (
                  <li key={alert.id}>
                    <Link href={`/alerts/${alert.id}`}>{alert.title}</Link>
                    <span className="dashboard-subtle">
                      {alert.severity} · {alert.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </PageSection>

          <PageSection
            title="Checks"
            description="Monitoring checks configured for this module."
            className="workspace-section-card"
            aria-label="Checks"
            persistKey={`project:${projectId}:module:${serviceId}:checks`}
            actions={
              !checksLoading && checks.length > 0 ? (
                <Link href={addCheckHref} className="secondary-button">
                  Add check
                </Link>
              ) : null
            }
          >
            {checksLoading ? (
              <div className="workspace-loading">
                <div className="loading-pulse" />
                <p>Loading checks…</p>
              </div>
            ) : null}

            {!checksLoading && checks.length === 0 ? (
              <EmptyState
                title="No checks for this module yet"
                description="Add a check to start monitoring availability, SSL, keywords, or latency for this module."
                action={
                  <Link href={addCheckHref} className="primary-button">
                    Add check
                  </Link>
                }
              />
            ) : null}

            {!checksLoading && checks.length > 0 ? (
              <div className="layer-health-table-wrap">
                <table className="data-table check-results-table">
                  <thead>
                    <tr>
                      <th>Check</th>
                      <th>Status</th>
                      <th>Last run</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checks.map((check) => {
                      const status = check.latestResult?.status || "PENDING";
                      return (
                        <tr key={check.id}>
                          <td data-label="Check">
                            <strong>{check.name}</strong>
                            {check.type ? (
                              <div className="table-subtle">{check.type}</div>
                            ) : null}
                          </td>
                          <td data-label="Status">
                            <HealthBadge status={checkStatusTone(status)} displayLabel={status} />
                          </td>
                          <td data-label="Last run">
                            {check.latestResult?.checkedAt
                              ? new Date(check.latestResult.checkedAt).toLocaleString()
                              : "—"}
                          </td>
                          <td data-label="Actions">
                            <Link className="text-link" href={`/checks/${check.id}`}>
                              View details
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </PageSection>
        </>
      ) : null}
    </ProjectWorkspaceShell>
  );
}
