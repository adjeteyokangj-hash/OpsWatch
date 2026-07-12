"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Shell } from "../../../../components/layout/shell";
import { Header } from "../../../../components/layout/header";
import { ProjectWorkspaceNav } from "../../../../components/projects/project-workspace-nav";
import { apiFetch } from "../../../../lib/api";

export default function ProjectSettingsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const [project, setProject] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const row = await apiFetch<any>(`/projects/${projectId}`);
        setProject(row);
      } catch (err: any) {
        setError(err?.message ?? "Failed to load project");
        setProject(null);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [projectId]);

  const handleDeleteProject = async () => {
    if (!project || confirmName !== project.name) {
      setError(`Type ${project?.name || "the project name"} to confirm deletion.`);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await apiFetch(`/projects/${project.id}`, { method: "DELETE" });
      router.push("/projects");
    } catch (err: any) {
      setError(err?.message ?? "Failed to delete project");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <Shell>
        <Header title="Project Settings" />
        <section className="panel">Loading…</section>
      </Shell>
    );
  }

  if (!project) {
    return (
      <Shell>
        <Header title="Project Settings" />
        {error ? <section className="panel error-panel">{error}</section> : null}
        <section className="panel">Project not found.</section>
      </Shell>
    );
  }

  return (
    <Shell>
      <Header title={`${project.name} Settings`} />
      <section className="panel">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link href="/projects">Projects</Link>
          <span aria-hidden="true"> / </span>
          <Link href={`/projects/${projectId}`}>{project.name}</Link>
          <span aria-hidden="true"> / </span>
          <span>Settings</span>
        </nav>
        <ProjectWorkspaceNav projectId={projectId} />
      </section>
      {error ? <section className="panel error-panel">{error}</section> : null}
      <section className="panel">
        <h2>Project settings</h2>
        <p className="dashboard-subtle">
          Operational settings for {project.name}. Billing, monitoring, and integrations are managed in their workspace tabs.
        </p>
      </section>
      <section className="panel danger-zone">
        <div className="section-head">
          <div>
            <h2>Danger zone</h2>
            <p>
              Delete this project and its services, checks, results, alerts, incidents, events, and heartbeats. Administrator
              permission is required.
            </p>
          </div>
          <button type="button" className="danger-button solid-danger-button" onClick={() => setShowDeleteConfirm(true)}>
            Delete project
          </button>
        </div>
      </section>
      {showDeleteConfirm ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Delete project">
          <section className="modal-panel" style={{ maxWidth: "520px" }}>
            <div className="section-head">
              <div>
                <h2>Delete {project.name}?</h2>
                <p>This cannot be undone. Type the project name to confirm.</p>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setConfirmName("");
                }}
              >
                Cancel
              </button>
            </div>
            <div className="stack-form">
              <label>
                Project name
                <input value={confirmName} onChange={(event) => setConfirmName(event.target.value)} placeholder={project.name} />
              </label>
              <button
                type="button"
                className="danger-button solid-danger-button"
                disabled={deleting || confirmName !== project.name}
                onClick={() => void handleDeleteProject()}
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </Shell>
  );
}
