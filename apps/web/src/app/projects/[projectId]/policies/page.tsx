"use client";

import { useParams } from "next/navigation";
import { PolicyLinkCards } from "../../../../components/projects/policy-link-cards";
import { PolicyRuleCards } from "../../../../components/projects/policy-rule-cards";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { PageSection } from "../../../../components/ui/page-section";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";

export default function ProjectPoliciesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, loading, error } = useProjectWorkspace(projectId);

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title="Policies"
      subtitle="Monitoring rules, thresholds, and automation boundaries for this application."
      project={project}
      loading={loading}
      error={error}
    >
      <PageSection
        title="Monitoring policies"
        description="Alert and incident rules scoped to this project."
        className="workspace-section-card"
        persistKey={`project:${projectId}:policies:monitoring`}
      >
        <PolicyRuleCards projectId={projectId} />
      </PageSection>
      <PageSection
        title="Related controls"
        description="Org-wide policy entry points linked to this project."
        className="workspace-section-card"
        persistKey={`project:${projectId}:policies:related`}
      >
        <PolicyLinkCards projectId={projectId} />
      </PageSection>
    </ProjectWorkspaceShell>
  );
}
