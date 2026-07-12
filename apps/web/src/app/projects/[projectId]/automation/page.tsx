"use client";



import Link from "next/link";

import { useParams } from "next/navigation";

import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";

import { WorkspaceSummaryStrip } from "../../../../components/projects/workspace-summary-strip";

import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";



const links = [

  { title: "Restart failed service", description: "Automatically restart a component after repeated check failures.", href: "/automation/playbooks", status: "Active", icon: "↻" },

  { title: "Escalate critical alerts", description: "Route CRITICAL alerts to on-call when incidents are open.", href: "/automation/playbooks", status: "Active", icon: "!" },

  { title: "Auto-run policy", description: "Autonomous action boundaries for this estate.", href: "/auto-run-policy", status: "Review", icon: "⚡" },

  { title: "Accuracy review", description: "Automation accuracy and operator overrides.", href: "/accuracy", status: "Active", icon: "◎" }

];



export default function ProjectAutomationPage() {

  const { projectId } = useParams<{ projectId: string }>();

  const { project, loading, error } = useProjectWorkspace(projectId);



  return (

    <ProjectWorkspaceShell

      projectId={projectId}

      title={project ? `${project.name} — Automation` : "Project Automation"}

      subtitle="Playbooks, auto-run policy, and automation quality controls."

      project={project}

      loading={loading}

      error={error}

    >

      <WorkspaceSummaryStrip

        cards={[

          { key: "active", label: "Active rules", value: 3, tone: "healthy" },

          { key: "runs", label: "Runs (24h)", value: 12, tone: "info" },

          { key: "success", label: "Success rate", value: "96%", tone: "healthy" },

          { key: "pending", label: "Pending approval", value: 1, tone: "degraded" }

        ]}

      />

      <section className="automation-rule-grid">

        {links.map((item) => (

          <Link key={item.title} href={item.href} className="automation-rule-card">

            <div className="automation-rule-head">

              <span className="automation-rule-icon" aria-hidden="true">

                {item.icon}

              </span>

              <span className={`automation-rule-status ${item.status.toLowerCase()}`}>{item.status}</span>

            </div>

            <h3>{item.title}</h3>

            <p>{item.description}</p>

            <span className="hub-card-link">Configure →</span>

          </Link>

        ))}

      </section>

      <section className="panel workspace-section-card">

        <div className="section-head">

          <div>

            <h2>Project checks</h2>

            <p className="dashboard-subtle">Checks scoped to this application.</p>

          </div>

        </div>

        <Link href={`/projects/${projectId}/checks`} className="primary-button">

          View project checks

        </Link>

      </section>

    </ProjectWorkspaceShell>

  );

}

