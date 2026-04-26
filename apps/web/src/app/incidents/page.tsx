"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { apiFetch } from "../../lib/api";
import { IncidentsTable } from "../../components/incidents/incidents-table";
import { FilterPresets, type FilterPreset } from "../../components/ui/filter-presets";
import { CopyFilterLink } from "../../components/ui/copy-filter-link";
import { StatCard } from "../../components/dashboard/stat-card";

type IncidentListItemDto = {
  id: string;
  title: string;
  severity: string;
  status: string;
  openedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  project: { id: string; name: string };
};

const INCIDENT_PRESETS: FilterPreset[] = [
  { label: "Active", params: { onlyUnresolved: "true" } },
  { label: "Critical active", params: { severity: "CRITICAL", onlyUnresolved: "true" } },
  { label: "Open only", params: { onlyOpen: "true" } },
  { label: "Resolved", params: { status: "RESOLVED" } }
];

function IncidentsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [incidents, setIncidents] = useState<IncidentListItemDto[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadProjects = async () => {
      try {
        const projectRows = await apiFetch<any[]>("/projects");
        setProjects(projectRows);
      } catch (err: any) {
        setError(err?.message || "Failed to load incidents metadata");
      }
    };

    void loadProjects();
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const query = searchParams.toString();
        const rows = await apiFetch<any[]>(`/incidents${query ? `?${query}` : ""}`);
        setIncidents(rows);
      } catch (err: any) {
        setError(err?.message || "Failed to load incidents");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [searchParams]);

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (!value) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    router.push(`/incidents?${next.toString()}`);
  };

  const updateBooleanFilter = (key: string, checked: boolean) => {
    const next = new URLSearchParams(searchParams.toString());
    if (!checked) {
      next.delete(key);
    } else {
      next.set(key, "true");
    }
    router.push(`/incidents?${next.toString()}`);
  };

  const projectId = searchParams.get("projectId") || "";
  const severity = searchParams.get("severity") || "";
  const status = searchParams.get("status") || "";
  const onlyOpen = searchParams.get("onlyOpen") === "true";
  const onlyUnresolved = searchParams.get("onlyUnresolved") === "true";
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";

  const unresolvedStatuses = new Set(["OPEN", "INVESTIGATING", "MONITORING"]);
  const openCount = incidents.filter((incident) => incident.status === "OPEN").length;
  const activeCount = incidents.filter((incident) => unresolvedStatuses.has(incident.status)).length;
  const resolvedCount = incidents.filter((incident) => incident.status === "RESOLVED").length;

  const displayIncidents = [...incidents].sort((a, b) => {
    const rank = (status: string) => (status === "OPEN" ? 0 : status === "INVESTIGATING" ? 1 : status === "MONITORING" ? 2 : 3);
    const byStatus = rank(a.status) - rank(b.status);
    if (byStatus !== 0) return byStatus;
    return new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime();
  });

  return (
    <Shell>
      <Header title="Incidents" />
      <section className="grid-6">
        <StatCard label="Incidents loaded" value={incidents.length} href="/incidents" />
        <StatCard label="Open" value={openCount} href="/incidents?status=OPEN" />
        <StatCard label="Active" value={activeCount} href="/incidents?onlyUnresolved=true" />
        <StatCard label="Resolved" value={resolvedCount} href="/incidents?status=RESOLVED" />
        <StatCard label="Critical active" value={incidents.filter((incident) => incident.severity === "CRITICAL" && unresolvedStatuses.has(incident.status)).length} href="/incidents?severity=CRITICAL&onlyUnresolved=true" />
        <StatCard label="Investigating" value={incidents.filter((incident) => incident.status === "INVESTIGATING").length} href="/incidents?status=INVESTIGATING" />
      </section>

      <section className="panel">
        <div className="section-head" style={{ marginBottom: "10px" }}>
          <FilterPresets basePath="/incidents" presets={INCIDENT_PRESETS} currentParams={searchParams.toString()} />
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <CopyFilterLink />
            {searchParams.toString() ? (
              <Link href="/incidents" className="secondary-button">Clear filters</Link>
            ) : null}
          </div>
        </div>
        <div className="form-row">
          <label>
            Project
            <select value={projectId} onChange={(event) => updateFilter("projectId", event.target.value)}>
              <option value="">All</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
          <label>
            Severity
            <select value={severity} onChange={(event) => updateFilter("severity", event.target.value)}>
              <option value="">All</option>
              <option value="CRITICAL">CRITICAL</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="LOW">LOW</option>
            </select>
          </label>
        </div>
        <div className="form-row" style={{ marginTop: "10px" }}>
          <label>
            Status
            <select value={status} onChange={(event) => updateFilter("status", event.target.value)}>
              <option value="">All</option>
              <option value="OPEN">OPEN</option>
              <option value="INVESTIGATING">INVESTIGATING</option>
              <option value="MONITORING">MONITORING</option>
              <option value="RESOLVED">RESOLVED</option>
            </select>
          </label>
          <label>
            Search title/root cause
            <input value={searchParams.get("q") || ""} onChange={(event) => updateFilter("q", event.target.value)} placeholder="Search incidents" />
          </label>
        </div>
        <div className="form-row" style={{ marginTop: "10px" }}>
          <label>
            <input type="checkbox" checked={onlyOpen} onChange={(event) => updateBooleanFilter("onlyOpen", event.target.checked)} />
            Only open
          </label>
          <label>
            <input type="checkbox" checked={onlyUnresolved} onChange={(event) => updateBooleanFilter("onlyUnresolved", event.target.checked)} />
            Only unresolved
          </label>
        </div>
        <div className="form-row" style={{ marginTop: "10px" }}>
          <label>
            Opened from
            <input type="datetime-local" value={dateFrom} onChange={(event) => updateFilter("dateFrom", event.target.value)} />
          </label>
          <label>
            Opened to
            <input type="datetime-local" value={dateTo} onChange={(event) => updateFilter("dateTo", event.target.value)} />
          </label>
        </div>
      </section>
      {error ? <section className="panel error-panel">{error}</section> : null}
      {loading ? (
        <section className="panel">Loading incidents...</section>
      ) : displayIncidents.length === 0 ? (
        <section className="panel">No incidents match current filters. Broaden filters to include historical incidents.</section>
      ) : (
        <>
          <section className="panel">
            <p>
              Showing active incidents first. Resolved incidents are grouped after active investigations.
            </p>
          </section>
          <IncidentsTable rows={displayIncidents} />
        </>
      )}
    </Shell>
  );
}

export default function IncidentsPage() {
  return (
    <Suspense fallback={<Shell><Header title="Incidents" /><section className="panel">Loading incidents...</section></Shell>}>
      <IncidentsPageContent />
    </Suspense>
  );
}
