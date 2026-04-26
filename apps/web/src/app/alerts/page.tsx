"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { apiFetch } from "../../lib/api";
import { AlertsTable } from "../../components/alerts/alerts-table";
import { FilterPresets, type FilterPreset } from "../../components/ui/filter-presets";
import { CopyFilterLink } from "../../components/ui/copy-filter-link";
import { StatCard } from "../../components/dashboard/stat-card";

type AlertListItemDto = {
  id: string;
  title: string;
  message: string;
  severity: string;
  status: string;
  category: string;
  sourceType: string;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  project: { id: string; name: string };
  service: { id: string; name: string } | null;
};

const ALERT_PRESETS: FilterPreset[] = [
  { label: "Critical open", params: { severity: "CRITICAL", status: "OPEN" } },
  { label: "High+ unresolved", params: { severity: "HIGH", onlyUnresolved: "true" } },
  { label: "All unresolved", params: { onlyUnresolved: "true" } },
  { label: "All open", params: { onlyOpen: "true" } },
  { label: "Resolved", params: { status: "RESOLVED" } }
];

function AlertsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [alerts, setAlerts] = useState<AlertListItemDto[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadMeta = async () => {
      try {
        const projectRows = await apiFetch<any[]>("/projects");
        setProjects(projectRows);
        const dedup = new Map<string, { id: string; name: string }>();
        for (const project of projectRows) {
          const serviceRows = project.services ?? project.Service ?? [];
          for (const service of serviceRows) {
            if (service?.id && service?.name) {
              dedup.set(service.id, { id: service.id, name: service.name });
            }
          }
        }
        setServices(Array.from(dedup.values()));
      } catch (err: any) {
        setError(err?.message || "Failed to load alerts metadata");
      }
    };

    void loadMeta();
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const query = searchParams.toString();
        const rows = await apiFetch<any[]>(`/alerts${query ? `?${query}` : ""}`);
        setAlerts(rows);
      } catch (err: any) {
        setError(err?.message || "Failed to load alerts");
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
    router.push(`/alerts?${next.toString()}`);
  };

  const updateBooleanFilter = (key: string, checked: boolean) => {
    const next = new URLSearchParams(searchParams.toString());
    if (!checked) {
      next.delete(key);
    } else {
      next.set(key, "true");
    }
    router.push(`/alerts?${next.toString()}`);
  };

  const projectId = searchParams.get("projectId") || "";
  const severity = searchParams.get("severity") || "";
  const status = searchParams.get("status") || "";
  const serviceId = searchParams.get("serviceId") || "";
  const onlyOpen = searchParams.get("onlyOpen") === "true";
  const onlyUnresolved = searchParams.get("onlyUnresolved") === "true";
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";

  const openCount = alerts.filter((alert) => alert.status === "OPEN").length;
  const acknowledgedCount = alerts.filter((alert) => alert.status === "ACKNOWLEDGED").length;
  const unresolvedCount = openCount + acknowledgedCount;
  const resolvedCount = alerts.filter((alert) => alert.status === "RESOLVED").length;

  const displayAlerts = [...alerts].sort((a, b) => {
    const rank = (status: string) => (status === "OPEN" ? 0 : status === "ACKNOWLEDGED" ? 1 : 2);
    const byStatus = rank(a.status) - rank(b.status);
    if (byStatus !== 0) return byStatus;
    return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
  });

  return (
    <Shell>
      <Header title="Alerts" />
      <section className="grid-6">
        <StatCard label="Alerts loaded" value={alerts.length} href="/alerts" />
        <StatCard label="Open" value={openCount} href="/alerts?status=OPEN" />
        <StatCard label="Acknowledged" value={acknowledgedCount} href="/alerts?status=ACKNOWLEDGED" />
        <StatCard label="Unresolved" value={unresolvedCount} href="/alerts?onlyUnresolved=true" />
        <StatCard label="Resolved" value={resolvedCount} href="/alerts?status=RESOLVED" />
        <StatCard label="Critical open" value={alerts.filter((a) => a.status !== "RESOLVED" && a.severity === "CRITICAL").length} href="/alerts?severity=CRITICAL&onlyUnresolved=true" />
      </section>

      <section className="panel alerts-filter-panel">
        <div className="section-head alerts-filter-head">
          <FilterPresets basePath="/alerts" presets={ALERT_PRESETS} currentParams={searchParams.toString()} />
          <div className="alerts-filter-actions">
            <CopyFilterLink />
            {searchParams.toString() ? (
              <Link href="/alerts" className="secondary-button">Clear filters</Link>
            ) : null}
          </div>
        </div>
        <div className="form-row alerts-filter-row alerts-filter-row--selects">
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
        <div className="form-row alerts-filter-row alerts-filter-row--selects">
          <label>
            Status
            <select value={status} onChange={(event) => updateFilter("status", event.target.value)}>
              <option value="">All</option>
              <option value="OPEN">OPEN</option>
              <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
              <option value="RESOLVED">RESOLVED</option>
            </select>
          </label>
          <label>
            Service
            <select value={serviceId} onChange={(event) => updateFilter("serviceId", event.target.value)}>
              <option value="">All</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>{service.name}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="alerts-filter-search">
          Search title/message
          <input value={searchParams.get("q") || ""} onChange={(event) => updateFilter("q", event.target.value)} placeholder="Search alerts" />
        </label>
        <div className="form-row alerts-filter-row alerts-filter-row--toggles">
          <label>
            <input type="checkbox" checked={onlyOpen} onChange={(event) => updateBooleanFilter("onlyOpen", event.target.checked)} />
            Only open
          </label>
          <label>
            <input type="checkbox" checked={onlyUnresolved} onChange={(event) => updateBooleanFilter("onlyUnresolved", event.target.checked)} />
            Only unresolved
          </label>
        </div>
        <div className="form-row alerts-filter-row alerts-filter-row--dates">
          <label>
            Seen from
            <input type="datetime-local" value={dateFrom} onChange={(event) => updateFilter("dateFrom", event.target.value)} />
          </label>
          <label>
            Seen to
            <input type="datetime-local" value={dateTo} onChange={(event) => updateFilter("dateTo", event.target.value)} />
          </label>
        </div>
      </section>
      {error ? <section className="panel error-panel">{error}</section> : null}
      {loading ? (
        <section className="panel">Loading alerts...</section>
      ) : displayAlerts.length === 0 ? (
        <section className="panel">No alerts match current filters. Try broadening filters or open alert history.</section>
      ) : (
        <>
          <section className="panel">
            <p>
              Showing active alerts first. Historical resolved alerts are listed after unresolved signals.
            </p>
          </section>
          <AlertsTable rows={displayAlerts} />
        </>
      )}
    </Shell>
  );
}

export default function AlertsPage() {
  return (
    <Suspense fallback={<Shell><Header title="Alerts" /><section className="panel">Loading alerts...</section></Shell>}>
      <AlertsPageContent />
    </Suspense>
  );
}
