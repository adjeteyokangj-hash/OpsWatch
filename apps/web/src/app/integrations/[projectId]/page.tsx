"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectConnectionsPanel } from "../../../components/integrations/project-connections-panel";
import { ProjectWorkspaceShell } from "../../../components/projects/project-workspace-shell";
import { apiFetch } from "../../../lib/api";
import {
  formatRelativeTime,
  summarizeProjectIntegrations,
  type IntegrationType,
  type ProjectIntegration,
  type ProjectOption
} from "../../../lib/integrations";

export default function ProjectIntegrationsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [project, setProject] = useState<ProjectOption | null>(null);
  const [integrations, setIntegrations] = useState<ProjectIntegration[]>([]);
  const [validatingKey, setValidatingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [projectRow, integrationRows] = await Promise.all([
          apiFetch<ProjectOption>(`/projects/${projectId}`),
          apiFetch<ProjectIntegration[]>(`/settings/integrations?projectId=${encodeURIComponent(projectId)}`)
        ]);
        setProject({ id: projectRow.id, name: projectRow.name, slug: projectRow.slug });
        setIntegrations(integrationRows);
      } catch (loadError: any) {
        setError(loadError?.message || "Failed to load project integrations");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [projectId]);

  const summary = useMemo(
    () => (project ? summarizeProjectIntegrations(project.id, integrations) : null),
    [project, integrations]
  );

  const validateIntegration = async (targetProjectId: string, type: IntegrationType) => {
    const key = `${targetProjectId}:${type}`;
    setValidatingKey(key);
    setError(null);
    try {
      const updated = await apiFetch<ProjectIntegration>(
        `/settings/integrations/${targetProjectId}/${type}/validate`,
        {
          method: "POST"
        }
      );
      setIntegrations((current) => {
        const index = current.findIndex((row) => row.projectId === targetProjectId && row.type === type);
        if (index === -1) return [...current, updated];
        const next = [...current];
        next[index] = updated;
        return next;
      });
    } catch (validateError: any) {
      setError(validateError?.message || "Failed to validate integration");
    } finally {
      setValidatingKey(null);
    }
  };

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title="Integrations"
      subtitle="Provider connections and validation status for this application."
      project={project}
      loading={loading}
      error={error}
      actions={
        <Link className="secondary-button" href="/integrations">
          All integrations
        </Link>
      }
    >
      {summary ? (
        <section className="panel integrations-overview-summary">
          <dl className="integrations-overview-summary__stats">
            <div>
              <dt>Status</dt>
              <dd>
                {summary.overallIcon} {summary.overallLabel}
              </dd>
            </div>
            <div>
              <dt>Healthy</dt>
              <dd>{summary.healthy}</dd>
            </div>
            <div>
              <dt>Require attention</dt>
              <dd>{summary.warnings}</dd>
            </div>
            <div>
              <dt>Last validation</dt>
              <dd>{formatRelativeTime(summary.lastValidatedAt)}</dd>
            </div>
          </dl>
          {summary.attentionMessage ? (
            <p className="project-integration-row__attention">{summary.attentionMessage}</p>
          ) : null}
        </section>
      ) : null}

      {loading || !project ? (
        <section className="panel workspace-loading">
          <div className="loading-pulse" />
          <p>Loading connections…</p>
        </section>
      ) : (
        <section className="panel">
          <ProjectConnectionsPanel
            project={project}
            integrations={integrations}
            validatingKey={validatingKey}
            onValidate={validateIntegration}
          />
        </section>
      )}
    </ProjectWorkspaceShell>
  );
}
