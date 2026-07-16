"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { EmptyState } from "../../../../components/ui/empty-state";
import { PageSection } from "../../../../components/ui/page-section";
import { WorkspaceSummaryStrip } from "../../../../components/projects/workspace-summary-strip";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";
import { apiFetch } from "../../../../lib/api";

type CheckRow = {
  id: string;
  name: string;
  type: string;
  service?: { id: string; name: string; project?: { id: string } };
  latestResult?: { status?: string; checkedAt?: string | null; responseTimeMs?: number | null } | null;
};

export default function ProjectMetricsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, loading, error } = useProjectWorkspace(projectId);
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const [checksLoading, setChecksLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setChecksLoading(true);
      try {
        const payload = await apiFetch<{ items: CheckRow[] }>("/checks");
        setChecks(
          (payload.items ?? []).filter((row) => row.service?.project?.id === projectId || !row.service?.project)
        );
      } catch {
        setChecks([]);
      } finally {
        setChecksLoading(false);
      }
    };
    void load();
  }, [projectId]);

  // Prefer project-scoped checks from workspace payload when present.
  const projectChecks = useMemo(() => {
    const fromProject: CheckRow[] = [];
    for (const service of project?.services ?? []) {
      const serviceChecks = service.checks ?? service.Check ?? [];
      for (const check of serviceChecks) {
        const result = Array.isArray(check.checkResults)
          ? check.checkResults[0]
          : Array.isArray(check.CheckResult)
            ? check.CheckResult[0]
            : check.latestResult ?? null;
        fromProject.push({
          id: check.id,
          name: check.name,
          type: check.type,
          service: { id: service.id, name: service.name, project: { id: projectId } },
          latestResult: result
            ? {
                status: result.status,
                checkedAt: result.checkedAt,
                responseTimeMs: result.responseTimeMs ?? null
              }
            : null
        });
      }
    }
    return fromProject.length > 0 ? fromProject : checks.filter((row) => row.service?.project?.id === projectId);
  }, [project, checks, projectId]);

  const withLatency = projectChecks.filter((row) => typeof row.latestResult?.responseTimeMs === "number");
  const avgLatency =
    withLatency.length === 0
      ? null
      : Math.round(
          withLatency.reduce((sum, row) => sum + (row.latestResult?.responseTimeMs ?? 0), 0) / withLatency.length
        );
  const pass = projectChecks.filter((row) => row.latestResult?.status === "PASS").length;
  const fail = projectChecks.filter((row) => row.latestResult?.status === "FAIL").length;

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title="Metrics"
      subtitle="Latency and check posture from completed monitoring results — no fabricated SLIs."
      project={project}
      loading={loading}
      error={error}
    >
      <WorkspaceSummaryStrip
        cards={[
          { key: "checks", label: "Checks", value: checksLoading ? "…" : projectChecks.length, tone: "info" },
          { key: "pass", label: "Passing", value: checksLoading ? "…" : pass, tone: "healthy" },
          { key: "fail", label: "Failing", value: checksLoading ? "…" : fail, tone: fail > 0 ? "critical" : "healthy" },
          {
            key: "latency",
            label: "Avg latency (ms)",
            value: checksLoading ? "…" : avgLatency == null ? "—" : avgLatency,
            tone: "info"
          }
        ]}
      />

      <PageSection title="Latest check latency" description="Values come from the most recent CheckResult per check.">
        {checksLoading ? <p>Loading metrics…</p> : null}
        {!checksLoading && projectChecks.length === 0 ? (
          <EmptyState
            title="No metric samples yet"
            description="Metrics appear after health checks complete for services in this application."
            action={
              <Link className="primary-button" href={`/projects/${projectId}/checks`}>
                Open checks
              </Link>
            }
          />
        ) : (
          <div className="table-cards-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Service</th>
                  <th>Status</th>
                  <th>Latency (ms)</th>
                  <th>Checked</th>
                </tr>
              </thead>
              <tbody>
                {projectChecks.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Check">{row.name}</td>
                    <td data-label="Service">{row.service?.name || "—"}</td>
                    <td data-label="Status">{row.latestResult?.status || "PENDING"}</td>
                    <td data-label="Latency">
                      {typeof row.latestResult?.responseTimeMs === "number"
                        ? row.latestResult.responseTimeMs
                        : "—"}
                    </td>
                    <td data-label="Checked">
                      {row.latestResult?.checkedAt
                        ? new Date(row.latestResult.checkedAt).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageSection>
    </ProjectWorkspaceShell>
  );
}
