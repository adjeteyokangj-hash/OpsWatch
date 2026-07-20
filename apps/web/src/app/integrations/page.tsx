"use client";

import { useEffect, useMemo, useState } from "react";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
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
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [validatingKey, setValidatingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectRows, integrationRows] = await Promise.all([
        apiFetch<ProjectOption[]>("/projects"),
        apiFetch<ProjectIntegration[]>("/settings/integrations")
      ]);
      setProjects(projectRows.map((row) => ({ id: row.id, name: row.name, slug: row.slug })));
      setIntegrations(integrationRows);
    } catch (loadError: any) {
      setError(loadError?.message || "Failed to load integrations");
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
    } catch (validateError: any) {
      setError(validateError?.message || "Failed to validate integration");
    } finally {
      setValidatingKey(null);
    }
  };

  return (
    <Shell>
      <Header title="Integrations" />
      <p className="dashboard-subtle">
        Monitor operational provider connections across applications. Billing and subscription Stripe settings live under Subscription.
      </p>
      {error ? <section className="panel error-panel">{error}</section> : null}

      <IntegrationsOverviewSummary summary={orgSummary} projectCount={projects.length} />

      <PageSection
        title="Applications"
        description={loading ? "Loading applications..." : "Expand one application at a time to review connection health."}
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
