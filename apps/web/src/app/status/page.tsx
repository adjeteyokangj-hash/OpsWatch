"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { API_BASE_URL } from "../../lib/constants";

type ServiceStatus = "HEALTHY" | "DEGRADED" | "DOWN" | "PAUSED";

type ServiceEntry = {
  id: string;
  name: string;
  type: string;
  status: ServiceStatus;
  isCritical: boolean;
  uptimePct: number | null;
};

type ProjectEntry = {
  id: string;
  name: string;
  slug: string;
  status: ServiceStatus;
  updatedAt: string;
  uptimePct: number | null;
  services: ServiceEntry[];
};

type IncidentEntry = {
  id: string;
  title: string;
  severity: string;
  status: string;
  openedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  project: { name: string; slug: string };
};

type StatusData = {
  updatedAt: string;
  overallStatus: "OPERATIONAL" | "DEGRADED" | "OUTAGE";
  projects?: ProjectEntry[];
  incidents?: IncidentEntry[];
};

type LegacyStatusData = {
  status?: "HEALTHY" | "DEGRADED" | "DOWN" | "PAUSED";
  project?: {
    id: string;
    name: string;
    slug: string;
    status: ServiceStatus;
    services?: Array<{ id: string; name: string; status: ServiceStatus }>;
  } | null;
};

const mapLegacyOverallStatus = (value: LegacyStatusData["status"]): StatusData["overallStatus"] => {
  if (value === "DOWN") return "OUTAGE";
  if (value === "DEGRADED" || value === "PAUSED") return "DEGRADED";
  return "OPERATIONAL";
};

const OVERALL_CONFIG = {
  OPERATIONAL: { label: "All systems operational", className: "status-banner operational" },
  DEGRADED:    { label: "Partial system degradation", className: "status-banner degraded" },
  OUTAGE:      { label: "Service outage in progress", className: "status-banner outage" }
};

const SVC_DOT: Record<ServiceStatus, string> = {
  HEALTHY:  "status-dot healthy",
  DEGRADED: "status-dot degraded",
  DOWN:     "status-dot down",
  PAUSED:   "status-dot paused"
};

const INCIDENT_STATUS_LABEL: Record<string, string> = {
  OPEN:         "Investigating",
  INVESTIGATING: "Investigating",
  MONITORING:   "Monitoring",
  RESOLVED:     "Resolved"
};

function UptimePill({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="uptime-pill unknown">No data</span>;
  const cls = pct >= 99.5 ? "uptime-pill good" : pct >= 95 ? "uptime-pill warn" : "uptime-pill bad";
  return <span className={cls}>{pct.toFixed(1)}% uptime</span>;
}

export default function StatusPage() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/status/public`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const payload = (await res.json()) as Partial<StatusData> & LegacyStatusData;

        const normalizedProjects = Array.isArray(payload.projects)
          ? payload.projects
          : payload.project
            ? [{
                id: payload.project.id,
                name: payload.project.name,
                slug: payload.project.slug,
                status: payload.project.status,
                updatedAt: new Date().toISOString(),
                uptimePct: null,
                services: (payload.project.services ?? []).map((service) => ({
                  id: service.id,
                  name: service.name,
                  type: "SERVICE",
                  status: service.status,
                  isCritical: false,
                  uptimePct: null
                }))
              }]
            : [];

        setData({
          updatedAt: payload.updatedAt ?? new Date().toISOString(),
          overallStatus: payload.overallStatus ?? mapLegacyOverallStatus(payload.status),
          projects: normalizedProjects,
          incidents: Array.isArray(payload.incidents) ? payload.incidents : []
        });
      } catch (e: any) {
        setError(e?.message || "Failed to load status");
      } finally {
        setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const incidents = data?.incidents ?? [];
  const projects = data?.projects ?? [];

  const openIncidents = incidents.filter(
    (i) => i.status !== "RESOLVED"
  );
  const resolvedIncidents = incidents.filter(
    (i) => i.status === "RESOLVED"
  );

  return (
    <Shell>
      <Header title="Status" />

      {loading && (
        <section className="panel">
          <p className="metric-label">Loading status…</p>
        </section>
      )}

      {error && (
        <section className="panel error-panel">{error}</section>
      )}

      {data && (
        <>
          {/* ── Overall health banner ────────────────────────────── */}
          <Link href="/alerts?status=OPEN" className={OVERALL_CONFIG[data.overallStatus].className}>
            <div className="banner-indicator" />
            <div>
              <strong>{OVERALL_CONFIG[data.overallStatus].label}</strong>
              <p className="banner-updated">
                Last updated {new Date(data.updatedAt).toLocaleTimeString()} · Auto-refreshes every 60s
              </p>
            </div>
          </Link>

          {/* ── Active incidents ─────────────────────────────────── */}
          {openIncidents.length > 0 && (
            <section className="panel">
              <h2 className="section-title">Active incidents</h2>
              <div className="incident-timeline">
                {openIncidents.map((inc) => (
                  <div key={inc.id} className={`timeline-item severity-${inc.severity.toLowerCase()}`}>
                    <div className="timeline-head">
                      <Link href={`/incidents/${inc.id}`} className="timeline-title-link"><strong>{inc.title}</strong></Link>
                      <span className={`result-pill ${inc.status === "MONITORING" ? "warn" : "fail"}`}>
                        {INCIDENT_STATUS_LABEL[inc.status] ?? inc.status}
                      </span>
                    </div>
                    <p className="timeline-meta">
                      {inc.project.name} · Started {new Date(inc.openedAt).toLocaleString()}
                    </p>
                    {inc.acknowledgedAt && (
                      <p className="timeline-meta">Acknowledged {new Date(inc.acknowledgedAt).toLocaleString()}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Component status ─────────────────────────────────── */}
          <section className="panel">
            <h2 className="section-title">Components</h2>
            <p className="metric-label" style={{ marginBottom: 12 }}>Uptime based on last 30 days of check results.</p>
            {projects.length === 0 ? (
              <p className="metric-label">No active projects configured.</p>
            ) : (
              <div className="status-components">
                {projects.map((project) => (
                  <div key={project.id} className="status-project-group">
                    <div className="status-project-head">
                      <div className="status-project-name">
                        <span className={SVC_DOT[project.status] ?? "status-dot healthy"} />
                        <Link href={`/projects/${project.id}`} className="status-project-link">{project.name}</Link>
                      </div>
                      <UptimePill pct={project.uptimePct} />
                    </div>

                    {(project.services ?? []).length > 0 && (
                      <div className="status-service-list">
                        {(project.services ?? []).map((svc) => (
                          <div key={svc.id} className="status-service-row">
                            <div className="svc-name-group">
                              <span className={SVC_DOT[svc.status] ?? "status-dot healthy"} />
                              <Link href={`/checks?serviceId=${svc.id}`}>{svc.name}</Link>
                              {svc.isCritical && <span className="svc-critical-badge">critical</span>}
                              <span className="svc-type">{svc.type.toLowerCase()}</span>
                            </div>
                            <div className="svc-right">
                              <UptimePill pct={svc.uptimePct} />
                              <span className={`svc-status-label ${svc.status.toLowerCase()}`}>
                                {svc.status}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Resolved incidents (last 30d) ─────────────────────── */}
          {resolvedIncidents.length > 0 && (
            <section className="panel">
              <h2 className="section-title">Recent resolved incidents</h2>
              <div className="incident-timeline resolved">
                {resolvedIncidents.map((inc) => (
                  <div key={inc.id} className="timeline-item resolved">
                    <div className="timeline-head">
                      <Link href={`/incidents/${inc.id}`} className="timeline-title-link"><strong>{inc.title}</strong></Link>
                      <span className="result-pill pass">Resolved</span>
                    </div>
                    <p className="timeline-meta">
                      {inc.project.name} ·{" "}
                      {inc.resolvedAt
                        ? `Resolved ${new Date(inc.resolvedAt).toLocaleString()}`
                        : `Opened ${new Date(inc.openedAt).toLocaleString()}`}
                    </p>
                    {inc.resolutionNotes && (
                      <p className="timeline-notes">{inc.resolutionNotes}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── All clear ─────────────────────────────────────────── */}
          {resolvedIncidents.length === 0 && openIncidents.length === 0 && (
            <section className="panel">
              <p className="metric-label">No incidents in the last 30 days. All systems have been running smoothly.</p>
            </section>
          )}
          {openIncidents.length === 0 && resolvedIncidents.length > 0 && (
            <section className="panel">
              <p className="metric-label">No active incidents. {resolvedIncidents.length} resolved in the last 30 days.</p>
            </section>
          )}
        </>
      )}
    </Shell>
  );
}

