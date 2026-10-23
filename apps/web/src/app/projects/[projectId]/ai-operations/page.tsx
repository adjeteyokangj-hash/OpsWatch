"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { AiOperationsStatus } from "../../../../components/intelligence/ai-operations-status";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";
import { apiFetch, type AiOperationsStatusPayload } from "../../../../lib/api";

export default function ProjectAiOperationsPage() {
  const projectId = String(useParams().projectId);
  const workspace = useProjectWorkspace(projectId);
  const [status, setStatus] = useState<AiOperationsStatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setStatus(null); setError(null); setLoading(true);
    void apiFetch<AiOperationsStatusPayload>(`/intelligence/operations-status?projectId=${encodeURIComponent(projectId)}`, { signal: controller.signal })
      .then(payload => { if (!controller.signal.aborted) setStatus(payload); })
      .catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "AI status could not be loaded"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, revision]);
  return <ProjectWorkspaceShell projectId={projectId} project={workspace.project} loading={workspace.loading}
    error={workspace.error} title="AI Operations" subtitle="Capability configuration, worker diagnostics and application evidence."
    actions={<button className="secondary-button" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh AI evidence</button>}>
    <section className="panel">
      <p>Decisions and learning evidence are scoped to this application. Worker runtime describes shared infrastructure. Missing evidence stays unknown and does not enable remediation.</p>
      <div className="module-catalogue-actions">
        <Link href={`/projects/${projectId}/incidents`}>Incident analysis</Link>
        <Link href={`/projects/${projectId}/automation`}>Approvals and verified outcomes</Link>
        <Link href={`/projects/${projectId}/settings?tab=automation`}>Application policy</Link>
        <Link href="/intelligence">Organisation learning and prediction reviews</Link>
      </div>
    </section>
    <AiOperationsStatus status={status} loading={loading} error={error} projectId={projectId} />
  </ProjectWorkspaceShell>;
}
