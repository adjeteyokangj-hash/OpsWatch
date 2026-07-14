"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { apiFetch } from "../../lib/api";
import { ProjectsTable } from "../../components/projects/projects-table";
import { ApplicationsPortfolioCards } from "../../components/projects/applications-portfolio-cards";
import { RegisterApplicationWizard } from "../../components/projects/register-application-wizard";
import { StatCard } from "../../components/dashboard/stat-card";
import { EmptyState } from "../../components/ui/empty-state";

type ViewMode = "cards" | "table";

function ProjectsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(searchParams.get("q") || "");
  const [viewMode, setViewMode] = useState<ViewMode>((searchParams.get("view") as ViewMode) || "cards");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiFetch<any[]>("/projects");
      setProjects(rows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load applications");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const healthFilter = searchParams.get("health") || "";
  const envFilter = searchParams.get("environment") || "";
  const ownerFilter = searchParams.get("owner") || "";

  const environments = useMemo(() => {
    const set = new Set<string>();
    for (const row of projects) {
      if (row.environment) set.add(String(row.environment));
    }
    return Array.from(set).sort();
  }, [projects]);

  const owners = useMemo(() => {
    const set = new Set<string>();
    for (const row of projects) {
      const owner = row.projectOwner || row.clientName;
      if (owner) set.add(String(owner));
    }
    return Array.from(set).sort();
  }, [projects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((row) => {
      if (healthFilter && row.status !== healthFilter) return false;
      if (envFilter && row.environment !== envFilter) return false;
      const owner = row.projectOwner || row.clientName || "";
      if (ownerFilter && owner !== ownerFilter) return false;
      if (!q) return true;
      const haystack = [row.name, row.slug, row.clientName, row.projectOwner, row.environment, row.healthReason]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [projects, healthFilter, envFilter, ownerFilter, search]);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (!value) next.delete(key);
    else next.set(key, value);
    router.push(`/projects?${next.toString()}`);
  };

  const healthyCount = projects.filter((row) => row.status === "HEALTHY").length;
  const degradedCount = projects.filter((row) => row.status === "DEGRADED").length;
  const downCount = projects.filter((row) => row.status === "DOWN").length;
  const awaitingCount = projects.filter((row) => row.status === "UNKNOWN").length;
  const pausedCount = projects.filter((row) => row.status === "PAUSED").length;
  const openAlerts = projects.reduce((sum, row) => sum + ((row.alerts || []).length || 0), 0);
  const unresolvedIncidents = projects.reduce(
    (sum, row) => sum + ((row.incidents || []).filter((incident: any) => incident.status !== "RESOLVED").length || 0),
    0
  );
  const knownClients = projects
    .map((row) => row.clientName)
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0);

  return (
    <Shell>
      <Header
        title="Applications"
        actions={
          <button type="button" className="primary-button" onClick={() => setShowWizard(true)} data-action="local-ui">
            + Register application
          </button>
        }
      />
      <section className="grid-6">
        <StatCard label="Registered applications" value={projects.length} href="/projects" />
        <StatCard label="Healthy" value={healthyCount} href="/projects?health=HEALTHY" />
        <StatCard label="Degraded" value={degradedCount} href="/projects?health=DEGRADED" />
        <StatCard label="Down" value={downCount} href="/projects?health=DOWN" />
        <StatCard label="Awaiting heartbeat" value={awaitingCount} href="/projects?health=UNKNOWN" />
        <StatCard label="Paused" value={pausedCount} href="/projects?health=PAUSED" />
      </section>
      <section className="grid-6">
        <StatCard label="Open alerts" value={openAlerts} href="/alerts?status=OPEN" />
        <StatCard label="Unresolved incidents" value={unresolvedIncidents} href="/incidents?onlyUnresolved=true" />
      </section>

      <section className="panel applications-filter-panel">
        <div className="form-row applications-filter-row">
          <label>
            Search
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onBlur={() => updateParam("q", search.trim())}
              onKeyDown={(event) => {
                if (event.key === "Enter") updateParam("q", search.trim());
              }}
              placeholder="Name, owner, client, environment…"
              aria-label="Search applications"
            />
          </label>
          <label>
            Health
            <select value={healthFilter} onChange={(event) => updateParam("health", event.target.value)}>
              <option value="">All</option>
              <option value="HEALTHY">Healthy</option>
              <option value="DEGRADED">Degraded</option>
              <option value="DOWN">Down</option>
              <option value="UNKNOWN">Unknown / awaiting</option>
              <option value="PAUSED">Paused</option>
              <option value="MAINTENANCE">Maintenance</option>
            </select>
          </label>
          <label>
            Environment
            <select value={envFilter} onChange={(event) => updateParam("environment", event.target.value)}>
              <option value="">All</option>
              {environments.map((env) => (
                <option key={env} value={env}>
                  {env}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ownership
            <select value={ownerFilter} onChange={(event) => updateParam("owner", event.target.value)}>
              <option value="">All</option>
              {owners.map((owner) => (
                <option key={owner} value={owner}>
                  {owner}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="applications-filter-actions">
          <div className="topology-view-toggle" role="group" aria-label="Portfolio view">
            <button
              type="button"
              className={viewMode === "cards" ? "active" : undefined}
              onClick={() => {
                setViewMode("cards");
                updateParam("view", "cards");
              }}
            >
              Cards
            </button>
            <button
              type="button"
              className={viewMode === "table" ? "active" : undefined}
              onClick={() => {
                setViewMode("table");
                updateParam("view", "table");
              }}
            >
              Table
            </button>
          </div>
          {searchParams.toString() ? (
            <button type="button" className="secondary-button" onClick={() => router.push("/projects")}>
              Clear filters
            </button>
          ) : null}
        </div>
      </section>

      {error ? <section className="panel error-panel">{error}</section> : null}
      {loading ? (
        <section className="panel" aria-busy="true">
          Loading applications…
        </section>
      ) : filtered.length === 0 ? (
        <section className="panel">
          <EmptyState
            title={projects.length === 0 ? "No applications yet" : "No applications match filters"}
            description={
              projects.length === 0
                ? "Register an application to establish a secure connection and start collecting health signals."
                : "Broaden search, health, environment, or ownership filters."
            }
            action={
              projects.length === 0 ? (
                <button type="button" className="primary-button" onClick={() => setShowWizard(true)}>
                  + Register application
                </button>
              ) : undefined
            }
          />
        </section>
      ) : viewMode === "table" ? (
        <ProjectsTable rows={filtered} />
      ) : (
        <ApplicationsPortfolioCards rows={filtered} />
      )}
      {showWizard ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Register application">
          <section className="modal-panel register-wizard-modal">
            <RegisterApplicationWizard
              knownClients={knownClients}
              onClose={() => setShowWizard(false)}
              onCreated={load}
            />
          </section>
        </div>
      ) : null}
    </Shell>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <Header title="Applications" />
          <section className="panel">Loading applications…</section>
        </Shell>
      }
    >
      <ProjectsPageContent />
    </Suspense>
  );
}
