"use client";

import { useEffect, useMemo, useState } from "react";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import type { ConnectionRecord } from "../../components/connections/types";
import { IntegrationsOverviewSummary } from "../../components/integrations/integrations-overview-summary";
import { ProjectIntegrationRow } from "../../components/integrations/project-integration-row";
import { PageSection } from "../../components/ui/page-section";
import { apiFetch } from "../../lib/api";
import {
  summarizeOrganizationIntegrations,
  type IntegrationType,
  type ProjectIntegration,
  type ProjectOption
} from "../../lib/integrations";

export default function IntegrationsPage() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [integrations, setIntegrations] = useState<ProjectIntegration[]>([]);
  const [monitoringConnections, setMonitoringConnections] = useState<ConnectionRecord[]>([]);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [validatingKey, setValidatingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectRows, integrationRows, connectionRows] = await Promise.all([
        apiFetch<ProjectOption[]>("/projects"),
        apiFetch<ProjectIntegration[]>("/settings/integrations"),
        apiFetch<ConnectionRecord[]>("/connections")
      ]);
      setProjects(projectRows.map((row) => ({ id: row.id, name: row.name, slug: row.slug })));
      setIntegrations(Array.isArray(integrationRows) ? integrationRows : []);
      setMonitoringConnections(Array.isArray(connectionRows) ? connectionRows : []);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const orgSummary = useMemo(
    () => summarizeOrganizationIntegrations(projects, integrations),
    [projects, integrations]
  );
  const connectedApplications = useMemo(
    () =>
      new Set(
        monitoringConnections
          .filter((row) => row.isActive && String(row.health).toUpperCase() === "HEALTHY")
          .map((row) => row.project?.id)
          .filter((value): value is string => Boolean(value))
      ).size,
    [monitoringConnections]
  );

  const validateIntegration = async (projectId: string, type: IntegrationType) => {
    const key = `${projectId}:${type}`;
    setValidatingKey(key);
    setError(null);
    try {
      const updated = await apiFetch<ProjectIntegration>(`/settings/integrations/${projectId}/${type}/validate`, {
        method: "POST"
      });
      setIntegrations((current) => {
        const index = current.findIndex((row) => row.projectId === projectId && row.type === type);
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

  return (
    <Shell>
      <Header title="Integrations" />
      <p className="dashboard-subtle">
        Review each application’s primary monitoring connection first, then add only the remediation and optional provider capabilities it supports.
      </p>
      {error ? <section className="panel error-panel">{error}</section> : null}

      <IntegrationsOverviewSummary summary={orgSummary} projectCount={projects.length} />
      <section className="panel">
        <strong>{connectedApplications} of {projects.length} applications have a healthy monitoring connection.</strong>
        <p className="table-subtle">
          Provider capability totals are separate from monitoring-source health and no longer determine whether an application is shown as connected.
        </p>
      </section>

      <PageSection
        title="Applications"
        description={loading ? "Loading applications..." : "Expand one application at a time to review its monitoring source and provider capabilities."}
        persistKey="org:integrations:applications"
      >
        {loading ? (
          <p>Loading integrations...</p>
        ) : projects.length === 0 ? (
          <p>No applications available.</p>
        ) : (
          <div className="project-integration-list">
            {projects.map((project) => (
              <ProjectIntegrationRow
                key={project.id}
                project={project}
                integrations={integrations}
                monitoringConnections={monitoringConnections}
                expanded={expandedProjectId === project.id}
                onToggle={() =>
                  setExpandedProjectId((current) => (current === project.id ? null : project.id))
                }
                validatingKey={validatingKey}
                onValidate={validateIntegration}
              />
            ))}
          </div>
        )}
      </PageSection>
    </Shell>
  );
}
