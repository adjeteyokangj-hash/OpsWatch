"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";
import { apiFetch } from "../../../../lib/api";

type ContactForm = {
  projectOwner: string;
  operationalContact: string;
};

export default function ProjectContactsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, loading, error, reload } = useProjectWorkspace(projectId);
  const [form, setForm] = useState<ContactForm>({ projectOwner: "", operationalContact: "" });
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    setForm({
      projectOwner: String(project.projectOwner || ""),
      operationalContact: String(project.operationalContact || "")
    });
  }, [project]);

  const saveContacts = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSuccessMsg(null);
    try {
      await apiFetch(`/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          projectOwner: form.projectOwner.trim() || null,
          operationalContact: form.operationalContact.trim() || null
        })
      });
      setSuccessMsg("Project contacts saved.");
      await reload();
    } catch (err: any) {
      setSuccessMsg(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title="Contacts"
      subtitle="Operational owners and on-call contacts for this application."
      project={project}
      loading={loading}
      error={error}
      actions={
        <button
          type="submit"
          form="project-contacts-form"
          className="primary-button"
          disabled={saving || loading}
          data-action="api"
          data-endpoint="/projects/:id"
        >
          {saving ? "Saving…" : "Save contacts"}
        </button>
      }
    >
      {successMsg ? <section className="panel success-panel">{successMsg}</section> : null}
      <section className="two-col settings-grid">
        <section className="panel">
          <h2>Operational contacts</h2>
          <p className="dashboard-subtle">
            People responsible for <strong>{project?.name || "this project"}</strong>. These are not OpsWatch login
            accounts.
          </p>
          {loading ? (
            <p>Loading contacts…</p>
          ) : (
            <form
              id="project-contacts-form"
              className="stack-form"
              onSubmit={(event) => void saveContacts(event)}
            >
              <label>
                Project owner
                <input
                  value={form.projectOwner}
                  onChange={(event) => setForm((current) => ({ ...current, projectOwner: event.target.value }))}
                  placeholder="e.g. Jane Smith, Head of Product"
                />
              </label>
              <label>
                Operational contact
                <input
                  value={form.operationalContact}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, operationalContact: event.target.value }))
                  }
                  placeholder="e.g. ops@client.com or on-call rotation"
                />
              </label>
            </form>
          )}
        </section>
        <aside className="panel">
          <h2>OpsWatch platform access</h2>
          <p className="dashboard-subtle">
            To add or manage people who can log in to OpsWatch (admins, operators, viewers), use{" "}
            <Link href="/members">Members</Link> in the sidebar.
          </p>
          <Link className="secondary-button" href="/members">
            Open Members
          </Link>
        </aside>
      </section>
    </ProjectWorkspaceShell>
  );
}
