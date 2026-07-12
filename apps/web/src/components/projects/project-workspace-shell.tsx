"use client";

import { ReactNode } from "react";
import { Shell } from "../layout/shell";
import { Header } from "../layout/header";
import { HealthBadge } from "../health/health-badge";
import { ProjectWorkspaceNav } from "./project-workspace-nav";

const signalAgeLabel = (receivedAt?: string | null): string => {
  if (!receivedAt) return "Waiting for first heartbeat";
  const ageMs = Date.now() - new Date(receivedAt).getTime();
  const ageMin = Math.floor(ageMs / 60000);
  if (ageMin < 2) return "Just now";
  if (ageMin < 60) return `${ageMin} min ago`;
  const ageHours = Math.floor(ageMin / 60);
  if (ageHours < 24) return `${ageHours} h ago`;
  return `${Math.floor(ageHours / 24)} d ago`;
};

type Props = {
  projectId: string;
  title: string;
  subtitle?: string;
  project?: any | null;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  actions?: ReactNode;
};

export function ProjectWorkspaceShell({
  projectId,
  title,
  subtitle,
  project,
  loading,
  error,
  children,
  actions
}: Props) {
  const healthLabel = project?.healthDisplayLabel ?? (project?.status === "UNKNOWN" ? "Waiting for first heartbeat" : project?.status);
  const latestSignal = project?.lastSignalAt ?? project?.lastCompletedCheckAt ?? project?.heartbeats?.[0]?.receivedAt;

  return (
    <Shell>
      <Header title={title} actions={actions} />
      {error ? <section className="panel error-panel">{error}</section> : null}
      <section className="panel workspace-hero">
        <ProjectWorkspaceNav projectId={projectId} />
        {loading ? (
          <p className="workspace-hero-loading">Loading project context…</p>
        ) : project ? (
          <div className="workspace-hero-body">
            <div className="workspace-hero-main">
              <p className="workspace-hero-title">
                <strong>{project.name}</strong>
              </p>
              <p className="workspace-hero-meta">
                <span className="meta-chip">{project.environment}</span>
                <span className="meta-chip">Client {project.clientName}</span>
                <span className="meta-chip">Automation {project.automationMode ?? "OBSERVE"}</span>
              </p>
              {subtitle ? <p className="workspace-hero-subtitle">{subtitle}</p> : null}
            </div>
            <div className="workspace-hero-status">
              <div className="workspace-status-block">
                <span className="workspace-status-label">Health</span>
                <HealthBadge status={project.status} displayLabel={healthLabel} />
              </div>
              <div className="workspace-status-block">
                <span className="workspace-status-label">Last signal</span>
                <strong>{signalAgeLabel(latestSignal)}</strong>
              </div>
              <div className="workspace-status-block">
                <span className="workspace-status-label">Monitored areas</span>
                <strong>{project.monitoredAreaCount ?? project.services?.length ?? 0}</strong>
              </div>
            </div>
          </div>
        ) : null}
      </section>
      {children}
    </Shell>
  );
}
