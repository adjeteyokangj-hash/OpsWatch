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
import { PageSection } from "../../components/ui/page-section";
import {
  defaultViewForCount,
  isTestApplication,
  matchesApplicationSearch,
  pageSizeForView,
  paginateRows,
  sortApplicationsForBrowse,
  type ApplicationRow
} from "../../lib/applications-browse";

type ViewMode = "cards" | "table";
type TestFilter = "all" | "hide" | "only";

function ProjectsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<ApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(searchParams.get("q") || "");
  const [viewInitialized, setViewInitialized] = useState(Boolean(searchParams.get("view")));
  const [viewMode, setViewMode] = useState<ViewMode>(
    (searchParams.get("view") as ViewMode) || "cards"
  );
  const [page, setPage] = useState(Math.max(1, Number(searchParams.get("page") || "1") || 1));

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiFetch<ApplicationRow[]>("/projects");
      setProjects(rows);
      if (!searchParams.get("view") && !viewInitialized) {
        const nextView = defaultViewForCount(rows.length);
        setViewMode(nextView);
        setViewInitialized(true);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load applications");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const healthFilter = searchParams.get("health") || "";
  const envFilter = searchParams.get("environment") || "";
  const ownerFilter = searchParams.get("owner") || "";
  const testFilter = (searchParams.get("test") as TestFilter) || "hide";

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
    const rows = projects.filter((row) => {
      if (healthFilter && row.status !== healthFilter) return false;
      if (envFilter && row.environment !== envFilter) return false;
      const owner = row.projectOwner || row.clientName || "";
      if (ownerFilter && owner !== ownerFilter) return false;
      const isTest = isTestApplication(row);
      if (testFilter === "hide" && isTest) return false;
      if (testFilter === "only" && !isTest) return false;
      return matchesApplicationSearch(row, search);
    });
    return sortApplicationsForBrowse(rows);
  }, [projects, healthFilter, envFilter, ownerFilter, testFilter, search]);

  const pageSize = pageSizeForView(viewMode);
  const paged = useMemo(
    () => paginateRows(filtered, page, pageSize),
    [filtered, page, pageSize]
  );

  useEffect(() => {
    if (page !== paged.page) setPage(paged.page);
  }, [page, paged.page]);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (!value) next.delete(key);
    else next.set(key, value);
    if (key !== "page") next.delete("page");
    router.push(`/projects?${next.toString()}`);
  };

  const syncSearchToUrl = (value: string) => {
    const trimmed = value.trim();
    updateParam("q", trimmed);
  };

  const clearSearch = () => {
    setSearch("");
    updateParam("q", "");
  };

  const setView = (next: ViewMode) => {
    setViewMode(next);
    setViewInitialized(true);
    setPage(1);
    updateParam("view", next);
  };

  const goToPage = (nextPage: number) => {
    setPage(nextPage);
    const next = new URLSearchParams(searchParams.toString());
    if (nextPage <= 1) next.delete("page");
    else next.set("page", String(nextPage));
    router.push(`/projects?${next.toString()}`);
  };

  const healthyCount = projects.filter((row) => row.status === "HEALTHY").length;
  const degradedCount = projects.filter((row) => row.status === "DEGRADED").length;
  const downCount = projects.filter((row) => row.status === "DOWN").length;
  const awaitingCount = projects.filter((row) => row.status === "UNKNOWN").length;
  const pausedCount = projects.filter((row) => row.status === "PAUSED").length;
  const openAlerts = projects.reduce(
    (sum, row) => sum + ((row.alerts as Array<unknown> | undefined)?.length || 0),
    0
  );
  const unresolvedIncidents = projects.reduce(
    (sum, row) =>
      sum +
      ((row.incidents as Array<{ status?: string }> | undefined) || []).filter(
        (incident) => incident.status !== "RESOLVED"
      ).length,
    0
  );
  const knownClients = projects
    .map((row) => row.clientName)
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0);
  const hiddenTestCount = projects.filter((row) => isTestApplication(row)).length;
  const hasActiveFilters =
    Boolean(searchParams.get("q")) ||
    Boolean(healthFilter) ||
    Boolean(envFilter) ||
    Boolean(ownerFilter) ||
    Boolean(searchParams.get("view")) ||
    Boolean(searchParams.get("page")) ||
    (searchParams.get("test") !== null && searchParams.get("test") !== "hide");

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

      <PageSection
        title="Search"
        description="Search by company name, application name or ID."
        persistKey="org:projects:search"
        className="applications-search-panel"
      >
        <label className="applications-search-label" htmlFor="applications-search">
          Search by company name, application name or ID
        </label>
        <div className="applications-search-row">
          <input
            id="applications-search"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            onBlur={() => syncSearchToUrl(search)}
            onKeyDown={(event) => {
              if (event.key === "Enter") syncSearchToUrl(search);
            }}
            placeholder="Search by company name, application name or ID"
            aria-label="Search by company name, application name or ID"
          />
          {search.trim() ? (
            <button type="button" className="secondary-button" onClick={clearSearch}>
              Clear search
            </button>
          ) : null}
        </div>
      </PageSection>

      <PageSection
        title="Filters"
        description="Health, environment, ownership, and portfolio view."
        persistKey="org:projects:filters"
        className="applications-filter-panel"
      >
        <div className="form-row applications-filter-row">
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
          <label>
            Test applications
            <select
              value={testFilter}
              onChange={(event) => updateParam("test", event.target.value === "hide" ? "" : event.target.value)}
            >
              <option value="hide">Hide test fixtures</option>
              <option value="all">Include test fixtures</option>
              <option value="only">Test fixtures only</option>
            </select>
          </label>
        </div>
        <div className="applications-filter-actions">
          <div className="topology-view-toggle" role="group" aria-label="Portfolio view">
            <button
              type="button"
              className={viewMode === "cards" ? "active" : undefined}
              onClick={() => setView("cards")}
            >
              Cards
            </button>
            <button
              type="button"
              className={viewMode === "table" ? "active" : undefined}
              onClick={() => setView("table")}
            >
              Table
            </button>
          </div>
          {hasActiveFilters ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setSearch("");
                setPage(1);
                setViewMode(defaultViewForCount(projects.length));
                setViewInitialized(true);
                router.push("/projects");
              }}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </PageSection>

      {error ? <section className="panel error-panel">{error}</section> : null}
      {loading ? (
        <section className="panel" aria-busy="true">
          Loading applications…
        </section>
      ) : filtered.length === 0 ? (
        <section className="panel">
          <EmptyState
            title={
              projects.length === 0
                ? "No applications yet"
                : search.trim()
                  ? "No applications match your search"
                  : "No applications match filters"
            }
            description={
              projects.length === 0
                ? "Register an application to establish a secure connection and start collecting health signals."
                : search.trim()
                  ? `Nothing matched “${search.trim()}”. Try another company name, application name, or ID.`
                  : "Broaden health, environment, ownership, or test-application filters."
            }
            action={
              projects.length === 0 ? (
                <button type="button" className="primary-button" onClick={() => setShowWizard(true)}>
                  + Register application
                </button>
              ) : search.trim() ? (
                <button type="button" className="secondary-button" onClick={clearSearch}>
                  Clear search
                </button>
              ) : undefined
            }
          />
        </section>
      ) : (
        <PageSection
          title="Applications"
          description={`Showing ${paged.start}–${paged.end} of ${paged.total} application${paged.total === 1 ? "" : "s"}.`}
          persistKey="org:projects:applications"
        >
          <div className="applications-results-meta" role="status">
            <span>
              Showing {paged.start}–{paged.end} of {paged.total} application
              {paged.total === 1 ? "" : "s"}
            </span>
            {testFilter === "hide" && hiddenTestCount > 0 ? (
              <button
                type="button"
                className="text-link"
                onClick={() => updateParam("test", "all")}
              >
                Show {hiddenTestCount} test application{hiddenTestCount === 1 ? "" : "s"}
              </button>
            ) : null}
          </div>
          {viewMode === "table" ? (
            <ProjectsTable rows={paged.slice} />
          ) : (
            <ApplicationsPortfolioCards rows={paged.slice} />
          )}
          {paged.totalPages > 1 ? (
            <nav className="applications-pagination" aria-label="Applications pagination">
              <button
                type="button"
                className="secondary-button"
                disabled={paged.page <= 1}
                onClick={() => goToPage(paged.page - 1)}
              >
                Previous
              </button>
              <span className="dashboard-subtle">
                Page {paged.page} of {paged.totalPages}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={paged.page >= paged.totalPages}
                onClick={() => goToPage(paged.page + 1)}
              >
                Next
              </button>
            </nav>
          ) : null}
        </PageSection>
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
