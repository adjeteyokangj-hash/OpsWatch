"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReactNode } from "react";
import { Shell } from "../layout/shell";
import { HealthBadge } from "../health/health-badge";
import { clearAuthCookies, getCsrfToken } from "../../lib/auth";
import { API_BASE_URL } from "../../lib/constants";
import { ProjectWorkspaceNav } from "./project-workspace-nav";
import { ProductTruthStatus } from "../ui/product-truth-status";

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

const isExplicitTestOrSeedRecord = (row: any): boolean => {
  const environment = String(row?.environment ?? "").toLowerCase();
  const provenance = String(row?.provenance ?? row?.discoverySource ?? "").toUpperCase();
  return (
    environment === "test" ||
    provenance === "TEST" ||
    provenance === "SEED" ||
    provenance === "SEEDED" ||
    row?.metadata?.testData === true ||
    row?.metadata?.seeded === true
  );
};

export const projectTestDataState = (
  project: any
): "test-application" | "mixed-non-test" | null => {
  if (!project) return null;
  if (String(project.environment ?? "").toLowerCase() === "test") return "test-application";
  const records = [
    ...(project.services ?? []),
    ...(project.events ?? []),
    ...(project.heartbeats ?? [])
  ];
  return records.some(isExplicitTestOrSeedRecord) ? "mixed-non-test" : null;
};

type Props = {
  projectId: string;
  /** Page title only (e.g. "Checks") — project name belongs in breadcrumbs. */
  title: string;
  subtitle?: string;
  breadcrumbLabel?: string;
  project?: any | null;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  actions?: ReactNode;
  /** Overview keeps a compact health strip; other pages hide it to avoid duplicate chrome. */
  showProjectStrip?: boolean;
};

export function ProjectWorkspaceShell({
  projectId,
  title,
  subtitle,
  breadcrumbLabel,
  project,
  loading,
  error,
  children,
  actions,
  showProjectStrip = false
}: Props) {
  const router = useRouter();
  const projectName = project?.name ?? "Application";
  const crumb = breadcrumbLabel ?? title;
  const healthLabel =
    project?.healthDisplayLabel ??
    (project?.status === "UNKNOWN" ? "Waiting for first heartbeat" : project?.status);
  const latestSignal =
    project?.lastSignalAt ?? project?.lastCompletedCheckAt ?? project?.heartbeats?.[0]?.receivedAt;
  const testDataState = projectTestDataState(project);

  const handleLogout = async () => {
    const csrfToken = getCsrfToken();
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: csrfToken ? { "x-opswatch-csrf": csrfToken } : undefined,
        cache: "no-store"
      });
    } catch {
      // Local sign-out still clears client auth state.
    } finally {
      clearAuthCookies();
      router.replace("/login");
    }
  };

  return (
    <Shell>
      <div className="project-workspace-page">
        <nav className="topology-breadcrumb" aria-label="Breadcrumb">
          <Link href="/projects">Projects</Link>
          <span aria-hidden="true">›</span>
          <Link href={`/projects/${projectId}`}>{loading && !project ? "…" : projectName}</Link>
          <span aria-hidden="true">›</span>
          <span>{crumb}</span>
        </nav>

        <header className="topology-page-header">
          <div>
            <p className="project-workspace-brand">OpsWatch</p>
            <h1 data-testid="page-heading">{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <div className="topology-page-actions">
            {actions}
            <button
              type="button"
              className="secondary-button header-logout"
              onClick={() => void handleLogout()}
              data-action="api"
              data-endpoint="/auth/logout"
            >
              Logout
            </button>
          </div>
        </header>

        <section className="panel topology-nav-panel">
          <ProjectWorkspaceNav projectId={projectId} />
        </section>

        {error ? <section className="panel error-panel">{error}</section> : null}

        {testDataState ? (
          <section
            className={`panel ${testDataState === "mixed-non-test" ? "error-panel" : ""}`}
            data-testid="project-test-data-indicator"
            role={testDataState === "mixed-non-test" ? "alert" : "status"}
          >
            <ProductTruthStatus state="Test data" />
            <p className="dashboard-subtle">
              {testDataState === "test-application"
                ? "This application is explicitly marked as a test environment. Its entities and results are test data unless independently live verified."
                : "Diagnostic: explicitly marked test/seed records are present in a non-test application. Do not treat them as live operational evidence."}
            </p>
          </section>
        ) : null}

        {loading && !project ? (
          <p className="workspace-hero-loading">Loading project context…</p>
        ) : null}

        {showProjectStrip && project ? (
          <section className="panel project-context-strip" aria-label="Project status">
            <div className="project-context-strip-main">
              <span className="meta-chip">{project.environment}</span>
              <span className="meta-chip">Client {project.clientName}</span>
              <span className="meta-chip">Automation {project.automationMode ?? "OBSERVE"}</span>
            </div>
            <div className="project-context-strip-status">
              <div className="workspace-status-block">
                <span className="workspace-status-label">Health</span>
                <HealthBadge status={project.status} displayLabel={healthLabel} />
              </div>
              <div className="workspace-status-block">
                <span className="workspace-status-label">Last signal</span>
                <strong>{signalAgeLabel(latestSignal)}</strong>
              </div>
            </div>
          </section>
        ) : null}

        {children}
      </div>
    </Shell>
  );
}
