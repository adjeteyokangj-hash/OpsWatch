"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { apiFetch } from "../../lib/api";
import { StatCard } from "../../components/dashboard/stat-card";
import { HealthOverview } from "../../components/dashboard/health-overview";
import { RecentAlerts } from "../../components/dashboard/recent-alerts";
import { RecentIncidents } from "../../components/dashboard/recent-incidents";

type ProjectRow = { id: string; name: string; status: "HEALTHY" | "DEGRADED" | "DOWN" | string };
type AlertRow = {
  id: string;
  title: string;
  severity: string;
  status: string;
  lastSeenAt: string;
  project: { id: string; name: string };
  service: { id: string; name: string } | null;
};
type IncidentRow = {
  id: string;
  title: string;
  severity: string;
  status: string;
  openedAt: string;
  resolvedAt: string | null;
  project: { id: string; name: string };
};
type CheckRow = {
  id: string;
  name: string;
  type: string;
  service: { id: string; name: string; project: { id: string; name: string } };
  latestResult?: { status?: string; checkedAt?: string | null } | null;
};

type InsightsRecommendation = {
  id: string;
  title: string;
  description: string;
  status: string;
  level: string;
};

type InsightsProject = {
  id: string;
  name: string;
  recommendations?: InsightsRecommendation[];
};

export default function DashboardPage() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const [checkSummary, setCheckSummary] = useState<{ total: number; pass: number; fail: number; warn: number; pending: number } | null>(null);
  const [recommendations, setRecommendations] = useState<Array<InsightsRecommendation & { projectName: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [projectsRes, alertsRes, incidentsRes, checksRes, insightsRes] = await Promise.all([
          apiFetch<ProjectRow[]>('/projects'),
          apiFetch<AlertRow[]>('/alerts'),
          apiFetch<IncidentRow[]>('/incidents'),
          apiFetch<{ items: CheckRow[]; summary: { total: number; pass: number; fail: number; warn: number; pending: number } }>('/checks'),
          apiFetch<{ projects: InsightsProject[] }>('/insights/product')
        ]);
        setProjects(projectsRes);
        setAlerts(alertsRes);
        setIncidents(incidentsRes);
        setChecks(checksRes.items);
        setCheckSummary(checksRes.summary);

        const openRecommendations = (insightsRes.projects || [])
          .flatMap((project) =>
            (project.recommendations || []).map((recommendation) => ({
              ...recommendation,
              projectName: project.name
            }))
          )
          .filter((recommendation) => recommendation.status === 'OPEN')
          .filter((recommendation) => !/localhost|127\.0\.0\.1|http:\/\//i.test(`${recommendation.title} ${recommendation.description}`));
        setRecommendations(openRecommendations.slice(0, 4));
      } catch (err: any) {
        setError(err?.message || "Failed to load dashboard data");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const healthy = projects.filter((p) => p.status === "HEALTHY").length;
  const degraded = projects.filter((p) => p.status === "DEGRADED").length;
  const down = projects.filter((p) => p.status === "DOWN").length;
  const primaryProject = projects[0] ?? null;
  const openAlerts = alerts.filter((a) => a.status === 'OPEN' || a.status === 'ACKNOWLEDGED');
  const unresolvedIncidents = incidents.filter((incident) => incident.status !== 'RESOLVED');
  const resolvedIncidents = incidents.filter((incident) => incident.status === 'RESOLVED');

  const latestAlerts = [...openAlerts]
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
    .slice(0, 8);

  const latestIncidents = [...unresolvedIncidents]
    .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime())
    .slice(0, 8);

  const noisyHistoryCount = alerts.length - openAlerts.length;
  const checkFailures = checks.filter((check) => check.latestResult?.status === 'FAIL').length;
  const checkWarns = checks.filter((check) => check.latestResult?.status === 'WARN').length;
  const weakServiceMap = checks.reduce<Record<string, number>>((acc, check) => {
    const status = check.latestResult?.status;
    if (status !== 'FAIL' && status !== 'WARN') return acc;
    const key = `${check.service?.project?.name || 'Unknown project'} / ${check.service?.name || 'Unknown service'}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const weakestServices = Object.entries(weakServiceMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <Shell>
      <Header title="Dashboard" />
      {loading ? <p>Loading live metrics...</p> : null}
      {error ? <p>Dashboard load warning: {error}. Showing last successful live data only.</p> : null}
      <section className="grid-6">
        <StatCard label="Projects" value={loading ? '-' : projects.length} href="/projects" />
        <StatCard label="Healthy projects" value={loading ? '-' : healthy} href="/projects?health=HEALTHY" />
        <StatCard label="Degraded projects" value={loading ? '-' : degraded} href="/projects?health=DEGRADED" />
        <StatCard label="Down projects" value={loading ? '-' : down} href="/projects?health=DOWN" />
        <StatCard
          label="Open alerts"
          value={loading ? '-' : openAlerts.length}
          href="/alerts?status=OPEN"
        />
        <StatCard
          label="Unresolved incidents"
          value={loading ? '-' : unresolvedIncidents.length}
          href="/incidents?onlyUnresolved=true"
        />
        <StatCard
          label="Failing checks"
          value={loading ? '-' : (checkSummary?.fail ?? '-')}
          href="/checks?latestStatus=FAIL"
        />
        <StatCard
          label="Checks pending"
          value={loading ? '-' : (checkSummary?.pending ?? '-')}
          href="/checks?latestStatus=PENDING"
        />
        <StatCard
          label="Checks with warnings"
          value={loading ? '-' : (checkSummary?.warn ?? '-')}
          href="/checks?latestStatus=WARN"
        />
        <StatCard
          label="Checks tracked"
          value={loading ? '-' : (checkSummary?.total ?? '-')}
          href="/checks"
        />
      </section>

      <section className="panel">
        <h2>Live Signal Credibility</h2>
        {loading ? <p>Evaluating live signal quality...</p> : null}
        {!loading ? (
          <ul className="dashboard-list">
            <li>
              <strong>Active operational signals:</strong> {openAlerts.length} open alerts and {unresolvedIncidents.length} unresolved incidents.
            </li>
            <li>
              <strong>Historical/stale kept secondary:</strong> {noisyHistoryCount} resolved or historical alert records are excluded from primary counters.
            </li>
            <li>
              <strong>Current check posture:</strong> {checkSummary?.pass ?? 0} pass, {checkFailures} fail, {checkWarns} warn, {checkSummary?.pending ?? 0} pending.
            </li>
            {primaryProject ? (
              <li>
                <strong>Fast path:</strong> <Link href={`/projects/${primaryProject.id}`}>Open {primaryProject.name} project control room</Link>.
              </li>
            ) : null}
          </ul>
        ) : null}
      </section>

      <HealthOverview healthy={healthy} degraded={degraded} down={down} />

      <section className="two-col">
        <RecentAlerts
          items={latestAlerts.map((alert) => ({
            id: alert.id,
            title: alert.title,
            severity: alert.severity,
            status: alert.status,
            projectName: alert.project?.name || 'Unknown project',
            serviceName: alert.service?.name || null,
            timestamp: alert.lastSeenAt
          }))}
          loading={loading}
        />
        <RecentIncidents
          items={latestIncidents.map((incident) => ({
            id: incident.id,
            title: incident.title,
            status: incident.status,
            severity: incident.severity,
            projectName: incident.project?.name || 'Unknown project',
            openedAt: incident.openedAt
          }))}
          resolvedCount={resolvedIncidents.length}
          loading={loading}
        />
      </section>

      <section className="two-col">
        <section className="panel">
          <h2>Check Health Snapshot</h2>
          {loading ? <p>Loading check health...</p> : null}
          {!loading ? (
            <>
              <p>
                Current checks: {checkSummary?.pass ?? 0} passing, {checkSummary?.fail ?? 0} failing, {checkSummary?.warn ?? 0} warning.
              </p>
              {weakestServices.length === 0 ? (
                <p>Monitoring healthy. No concentrated service failures.</p>
              ) : (
                <ul className="dashboard-list">
                  {weakestServices.map(([serviceName, issueCount]) => (
                    <li key={serviceName}>
                      {serviceName}: {issueCount} active check issue{issueCount === 1 ? '' : 's'}
                    </li>
                  ))}
                </ul>
              )}
              <p>
                <Link href="/checks">Open checks page</Link>
              </p>
            </>
          ) : null}
        </section>

        <section className="panel">
          <h2>Actionable Recommendations</h2>
          {loading ? <p>Loading recommendations...</p> : null}
          {!loading && recommendations.length === 0 ? <p>No active recommendations. Monitoring healthy.</p> : null}
          {!loading && recommendations.length > 0 ? (
            <ul className="dashboard-list">
              {recommendations.map((recommendation) => (
                <li key={recommendation.id}>
                  <strong>{recommendation.title}</strong>
                  <div className="dashboard-subtle">{recommendation.projectName} · {recommendation.level}</div>
                  <div>{recommendation.description}</div>
                </li>
              ))}
            </ul>
          ) : null}
          <p>
            <Link href="/insights">Open insights page</Link>
          </p>
        </section>
      </section>
    </Shell>
  );
}
