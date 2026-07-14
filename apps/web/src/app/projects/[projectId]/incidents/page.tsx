"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { IncidentsTable } from "../../../../components/incidents/incidents-table";
import { IncidentQuickDrawer } from "../../../../components/incidents/incident-quick-drawer";
import { EmptyState } from "../../../../components/ui/empty-state";
import { WorkspaceSummaryStrip } from "../../../../components/projects/workspace-summary-strip";
import { useProjectWorkspace } from "../../../../hooks/use-project-workspace";
import { apiFetch } from "../../../../lib/api";

export default function ProjectIncidentsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, loading, error } = useProjectWorkspace(projectId);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setListLoading(true);
      try {
        const rows = await apiFetch<any[]>(`/incidents?projectId=${projectId}`);
        setIncidents(rows);
      } catch {
        setIncidents([]);
      } finally {
        setListLoading(false);
      }
    };
    if (projectId) void load();
  }, [projectId]);

  const unresolved = incidents.filter((row) => row.status !== "RESOLVED");
  const selected = incidents.find((row) => row.id === selectedId) ?? null;

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title={project ? `${project.name} — Incidents` : "Incidents"}
      subtitle="Severity, ownership, affected scope, and deploy correlation from recorded data."
      project={project}
      loading={loading}
      error={error}
    >
      <WorkspaceSummaryStrip
        cards={[
          { key: "total", label: "Incidents", value: listLoading ? "…" : incidents.length, tone: "info" },
          { key: "active", label: "Unresolved", value: listLoading ? "…" : unresolved.length, tone: unresolved.length ? "critical" : "healthy" },
          {
            key: "critical",
            label: "Critical active",
            value: listLoading
              ? "…"
              : unresolved.filter((row) => row.severity === "CRITICAL").length,
            tone: "degraded"
          }
        ]}
      />

      {listLoading ? <section className="panel">Loading incidents…</section> : null}
      {!listLoading && incidents.length === 0 ? (
        <EmptyState
          title="No incidents for this application"
          description="Incidents appear when alerts correlate into an incident record."
        />
      ) : null}
      {!listLoading && incidents.length > 0 ? (
        <IncidentsTable rows={incidents} onSelectRow={(id) => setSelectedId(id)} selectedId={selectedId} />
      ) : null}

      <p>
        <Link className="text-link" href={`/incidents?projectId=${projectId}`}>
          Open global incidents filter →
        </Link>
      </p>

      <IncidentQuickDrawer
        incident={selected}
        onClose={() => setSelectedId(null)}
        onStatusChanged={(id, status) => {
          setIncidents((rows) => rows.map((row) => (row.id === id ? { ...row, status } : row)));
        }}
      />
    </ProjectWorkspaceShell>
  );
}
