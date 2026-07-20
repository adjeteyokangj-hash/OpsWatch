"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckResultsTable } from "../../../../components/projects/check-results-table";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";
import { apiFetch } from "../../../../lib/api";

type CheckRow = {
  id: string;
  name: string;
  latestResult?: { status: string; checkedAt: string } | null;
};

type CheckListResponse = {
  items: CheckRow[];
  summary: { total: number; pass: number; fail: number; warn: number; pending: number };
};

const normalizeChecks = (response: CheckListResponse | CheckRow[]): CheckRow[] =>
  Array.isArray(response) ? response : response.items ?? [];

export default function ProjectChecksPage() {
  const params = useParams<{ projectId: string }>();
  const { project, loading: projectLoading, error: projectError } = useProjectWorkspace(params.projectId);
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.projectId) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch<CheckListResponse | CheckRow[]>(
          `/checks?projectId=${params.projectId}`
        );
        setChecks(normalizeChecks(response));
      } catch (err: any) {
        setError(err?.message || "Failed to load checks");
        setChecks([]);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [params.projectId]);

  return (
    <ProjectWorkspaceShell
      projectId={params.projectId}
      title="Checks"
      subtitle="Monitoring checks and latest run results for this application."
      project={project}
      loading={projectLoading}
      error={projectError ?? error}
      actions={
        <>
          <Link href={`/checks?projectId=${params.projectId}`} className="primary-button">
            Open checks console
          </Link>
          <Link href={`/projects/${params.projectId}/topology`} className="secondary-button">
            View topology
          </Link>
        </>
      }
    >
      {loading ? (
        <section className="panel workspace-loading">
          <div className="loading-pulse" />
          <p>Loading checks…</p>
        </section>
      ) : (
        <CheckResultsTable rows={checks} projectId={params.projectId} />
      )}
    </ProjectWorkspaceShell>
  );
}
