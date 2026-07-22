"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectConnectionsPanel } from "../../../components/integrations/project-connections-panel";
import type { ConnectionRecord } from "../../../components/connections/types";
import { ProjectWorkspaceShell } from "../../../components/projects/project-workspace-shell";
import { PageSection } from "../../../components/ui/page-section";
import { apiFetch } from "../../../lib/api";
import { ConfigureSetupReturnBanner } from "../../../components/ui/configure-setup-return-banner";
import {
  formatRelativeTime,
  summarizeProjectIntegrations,
  type IntegrationType,
  type ProjectIntegration,
  type ProjectOption
} from "../../../lib/integrations";

const latestTimestamp = (values: Array<string | null | undefined>): string | null => {
  const valid = values
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  return valid.length > 0 ? new Date(Math.max(...valid)).toISOString() : null;
};

export default function ProjectIntegrationsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [project, setProject] = useState<ProjectOption | null>(null);
  const [integrations, setIntegrations] = useState<ProjectIntegration[]>([]);
  const [monitoringConnections, setMonitoringConnections] = useState<ConnectionRecord[]>([]);
  const [validatingKey, setValidatingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [projectRow, integrationRows, connectionRows] = await Promise.all([
          apiFetch<ProjectOption>(`/projects/${projectId}`),
          apiFetch<ProjectIntegration[]>(`/settings/integrations?projectId=${encodeURIComponent(projectId)}`),
          apiFetch<ConnectionRecord[]>("/connections")
        ]);
        setProject({ id: projectRow.id, name: projectRow.name, slug: projectRow.slug });
        setIntegrations(Array.isArray(integrationRows) ? integrationRows : []);
        setMonitoringConnections(Array.isArray(connectionRows) ? connectionRows : []);
      } catch (loadError: unknown) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load application connections");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [projectId]);

  const projectMonitoringConnections = useMemo(
    () => monitoringConnections.filter((row) => row.project?.id === projectId),
    [monitoringConnections, projectId]
  );
  const providerSummary = useMemo(
    () => (project ? summarizeProjectIntegrations(project.id, integrations) : null),
    [project, integrations]
  );
  const primaryConnection =
    projectMonitoringConnections.find(
      (row) => row.isActive && String(row.health).toUpperCase() === "HEALTHY"
    ) ??
    projectMonitoringConnections.find((row) => row.isActive) ??
    projectMonitoringConnections[0];
  const workerRemediator = integrations.find(
    (row) => row.projectId === projectId && row.type === "WORKER_PROVIDER"
  );
  const additionalConfigured = integrations.filter(
    (row) => row.projectId === projectId && row.type !== "WORKER_PROVIDER"
  ).length;
  const lastValidationAt = latestTimestamp([
    ...projectMonitoringConnections.map((row) => row.lastValidatedAt),
    ...integrations.map((row) => row.lastValidatedAt)
  ]);

  const validateIntegration = async (targetProjectId: string, type: IntegrationType) => {
    const key = `${targetProjectId}:${type}`;
    setValidatingKey(key);
    setError(null);
    try {
      const updated = await apiFetch<ProjectIntegration>(
        `/settings/integrations/${targetProjectId}/${type}/validate`,
        { method: "POST" }
      );
      setIntegrations((current) => {
        const index = current.findIndex(
          (row) => row.projectId === targetProjectId && row.type === type
        );
        if (index === -1) return [...current, updated];
        const next = [...current];
        next[index] = updated;
        return next;
      });
    } catch (validateError: unknown) {
      setError(validateError instanceof Error ? validateError.message : "Failed to validate integration");
    } finally {
      setValidatingKey(null);
    }
  };

  const monitoringStatus = !primaryConnection
    ? "⚪ Not connected"
    : !primaryConnection.isActive
      ? "⚪ Disabled"
      : String(primaryConnection.health).toUpperCase() === "HEALTHY"
        ? "🟢 Connected"
        : "🟡 Needs attention";
  const remediatorStatus = !workerRemediator
    ? "⚪ Setup required"
    : workerRemediator.validationStatus === "VALID"
      ? "🟢 Connected"
      : workerRemediator.validationStatus === "INVALID"
        ? "🔴 Validation failed"
        : "🟡 Validation pending";

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title="Integrations"
      subtitle="One application connection workspace for monitoring, remediation and optional provider capabilities."
      project={project}
      loading={loading}
      error={error}
      actions={
        <Link className="secondary-button" href="/integrations">
          All integrations
        </Link>
      }
    >
      <Suspense fallback={null}>
        <ConfigureSetupReturnBanner />
      </Suspense>

      {project ? (
        <section className="panel integrations-overview-summary">
          <dl className="integrations-overview-summary__stats">
            <div>
              <dt>Monitoring connection</dt>
              <dd>{monitoringStatus}</dd>
            </div>
            <div>
              <dt>Worker remediator</dt>
              <dd>{remediatorStatus}</dd>
            </div>
            <div>
              <dt>Additional capabilities</dt>
              <dd>{additionalConfigured} configured</dd>
            </div>
            <div>
              <dt>Last validation</dt>
              <dd>{formatRelativeTime(lastValidationAt)}</dd>
            </div>
          </dl>
          {primaryConnection ? (
            <p className="table-subtle">
              {primaryConnection.name} is the primary monitoring connection. Provider capabilities below extend it; they do not replace it.
            </p>
          ) : providerSummary?.attentionMessage ? (
            <p className="project-integration-row__attention">{providerSummary.attentionMessage}</p>
          ) : null}
        </section>
      ) : null}

      {loading || !project ? (
        <section className="panel workspace-loading">
          <div className="loading-pulse" />
          <p>Loading connections…</p>
        </section>
      ) : (
        <PageSection
          title="Connection capabilities"
          description="The live monitoring connection is shown first. Add only the remediation or optional provider capabilities this application actually supports."
          persistKey={`project:${projectId}:integrations:connections`}
        >
          <ProjectConnectionsPanel
            project={project}
            integrations={integrations}
            monitoringConnections={projectMonitoringConnections}
            validatingKey={validatingKey}
            onValidate={validateIntegration}
          />
        </PageSection>
      )}
    </ProjectWorkspaceShell>
  );
}
