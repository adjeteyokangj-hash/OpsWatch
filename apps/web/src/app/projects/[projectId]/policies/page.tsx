"use client";



import { useParams } from "next/navigation";

import { PolicyLinkCards } from "../../../../components/projects/policy-link-cards";

import { PolicyRuleCards } from "../../../../components/projects/policy-rule-cards";

import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";

import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";



export default function ProjectPoliciesPage() {

  const { projectId } = useParams<{ projectId: string }>();

  const { project, loading, error } = useProjectWorkspace(projectId);



  return (

    <ProjectWorkspaceShell

      projectId={projectId}

      title={project ? `${project.name} — Policies` : "Project Policies"}

      subtitle="Monitoring rules, thresholds, and automation boundaries for this application."

      project={project}

      loading={loading}

      error={error}

    >

      <section className="panel workspace-section-card">

        <div className="section-head">

          <div>

            <h2>Monitoring policies</h2>

            <p className="dashboard-subtle">Alert and incident rules scoped to this project.</p>

          </div>

        </div>

        <PolicyRuleCards projectId={projectId} />

      </section>

      <section className="panel workspace-section-card">

        <div className="section-head">

          <div>

            <h2>Related controls</h2>

            <p className="dashboard-subtle">Org-wide policy entry points linked to this project.</p>

          </div>

        </div>

        <PolicyLinkCards projectId={projectId} />

      </section>

    </ProjectWorkspaceShell>

  );

}

