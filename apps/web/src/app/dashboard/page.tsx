"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { apiFetch } from "../../lib/api";
import { fetchSessionUser } from "../../lib/auth";
import { StatCard } from "../../components/dashboard/stat-card";
import { HealthOverview } from "../../components/dashboard/health-overview";
import { RecentAlerts } from "../../components/dashboard/recent-alerts";
import { RecentIncidents } from "../../components/dashboard/recent-incidents";
import { LayerHealthTable, type LayerHealthRow } from "../../components/health/layer-health-table";
import { DashboardAppStatusTable } from "../../components/health/dashboard-app-status-table";
import { PageSection } from "../../components/ui/page-section";
import { EmptyState } from "../../components/ui/empty-state";
import { LearningStateBanner } from "../../components/ui/learning-state-banner";
import { StatusBadge } from "../../components/ui/status-badge";

type ProjectRow = {
  id: string;
  name: string;
  environment: string;
  status: "HEALTHY" | "DEGRADED" | "DOWN" | string;
  healthDisplayLabel?: string | null;
  lastSignalAt?: string | null;
  lastCompletedCheckAt?: string | null;
  alerts?: Array<{ id: string }>;
};

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

type IntelligenceTeaser = {
  learningState: "EMPTY" | "LEARNING" | "ACTIVE";
  emptyReason: string | null;
  counters: {
    automationRuns: number;
    deployments: number;
    patternsDisplayable: number;
    baselinesReady: number;
  };
  predictions: { enabled: boolean; status: string; reason: string };
  automationHistory: Array<{
    id: string;
    incidentId: string;
    status: string;
    success: boolean | null;
    reason: string | null;
    createdAt: string;
  }>;
};

type CheckMetrics = {
  items: CheckRow[];
  summary: { total: number; pass: number; fail: number; warn: number; pending: number };
};

const formatLoadFailure = (label: string, reason: unknown): string => {
  const message = reason instanceof Error ? reason.message : String(reason);
  return `${label} (${message || "failed"})`;
};

export default function DashboardPage() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const [checkSummary, setCheckSummary] = useState<{
    total: number;
    pass: number;
    fail: number;
    warn: number;
    pending: number;
  } | null>(null);
  const [recommendations, setRecommendations] = useState<
    Array<InsightsRecommendation & { projectName: string }>
  >([]);
  const [layerHealth, setLayerHealth] = useState<LayerHealthRow[]>([]);
  const [intelligence, setIntelligence] = useState<IntelligenceTeaser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionOrgMissing, setSessionOrgMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const CORE_LOAD_BUDGET_MS = 12_000;
    const failures = new Map<string, string>();

    const publishFailures = (): void => {
      if (cancelled) return;
      const details = Array.from(failures.values());
      setError(
        details.length > 0
          ? `Some dashboard data failed to load: ${details.join("; ")}. Showing available live data only.`
          : null
      );
    };

    const runMetric = async <T,>(
      label: string,
      request: Promise<T>,
      apply: (value: T) => void
    ): Promise<void> => {
      try {
        const value = await request;
        if (!cancelled) apply(value);
      } catch (reason) {
        failures.set(label, formatLoadFailure(label, reason));
        publishFailures();
      }
    };

    setLoading(true);
    setError(null);
    setSessionOrgMissing(false);

    const coreBudgetTimer = window.setTimeout(() => {
      if (cancelled) return;
      setLoading(false);
      setError((current) =>
        current ??
        "Core dashboard metrics are taking longer than expected. Displaying each live result as it becomes available."
      );
    }, CORE_LOAD_BUDGET_MS);

    const coreTasks = [
      runMetric(
        "projects",
        apiFetch<ProjectRow[]>("/projects", { suppressAuthRedirect: true }),
        setProjects
      ),
      runMetric(
        "alerts",
        apiFetch<AlertRow[]>("/alerts", { suppressAuthRedirect: true }),
        setAlerts
      ),
      runMetric(
        "incidents",
        apiFetch<IncidentRow[]>("/incidents", { suppressAuthRedirect: true }),
        setIncidents
      ),
      runMetric(
        "checks",
        apiFetch<CheckMetrics>("/checks", { suppressAuthRedirect: true }),
        (value) => {
          setChecks(value.items);
          setCheckSummary(value.summary);
        }
      )
    ];

    const secondaryTasks = [
      runMetric(
        "insights",
        apiFetch<{ projects: InsightsProject[] }>("/insights/product", {
          suppressAuthRedirect: true
        }),
        (value) => {
          const openRecommendations = (value.projects || [])
            .flatMap((project) =>
              (project.recommendations || []).map((recommendation) => ({
                ...recommendation,
                projectName: project.name
              }))
            )
            .filter((recommendation) => recommendation.status === "OPEN")
            .filter(
              (recommendation) =>
                !/localhost|127\.0\.0\.1|http:\/\//i.test(
                  `${recommendation.title} ${recommendation.description}`
                )
            );
          setRecommendations(openRecommendations.slice(0, 4));
        }
      ),
      runMetric(
        "layer health",
        apiFetch<LayerHealthRow[]>("/analytics/layer-health", {
          suppressAuthRedirect: true
        }),
        setLayerHealth
      ),
      runMetric(
        "intelligence",
        apiFetch<IntelligenceTeaser>("/intelligence?harvest=false", {
          suppressAuthRedirect: true
        }),
        setIntelligence
      )
    ];

    void Promise.all(coreTasks).then(() => {
      window.clearTimeout(coreBudgetTimer);
      if (cancelled) return;
      setLoading(false);
      publishFailures();
    });

    // Secondary insights must never hold Projects, Alerts, Incidents or Checks hostage.
    void Promise.all(secondaryTasks).then(publishFailures);

    void fetchSessionUser()
      .then((sessionUser) => {
        if (!cancelled && sessionUser && !sessionUser.organizationId) {
          setSessionOrgMissing(true);
        }
      })
      .catch(() => {
        // API/session availability is reported by the metric requests themselves.
      });

    return () => {
      cancelled = true;
      window.clearTimeout(coreBudgetTimer);
    };
  }, []);

  const healthy = projects.filter((p) => p.status === "HEALTHY").length;
  const degraded = projects.filter((p) => p.status === "DEGRADED").length;
  const down = projects.filter((p) => p.status === "DOWN").length;
  const primaryProject = projects[0] ?? null;
  const openAlerts = alerts.filter((a) => a.status === "OPEN" || a.status === "ACKNOWLEDGED");
  const unresolvedIncidents = incidents.filter((incident) => incident.status !== "RESOLVED");
  const resolvedIncidents = incidents.filter((incident) => incident.status === "RESOLVED");

  const latestAlerts = [...openAlerts]
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
    .slice(0, 8);

  const latestIncidents = [...unresolvedIncidents]
    .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime())
    .slice(0, 8);

  const noisyHistoryCount = alerts.length - openAlerts.length;
  const checkFailures = checks.filter((check) => check.latestResult?.status === "FAIL").length;
  const checkWarns = checks.filter((check) => check.latestResult?.status === "WARN").length;
  const weakServiceMap = checks.reduce<Record<string, number>>((acc, check) => {
    const status = check.latestResult?.status;
    if (status !== "FAIL" && status !== "WARN") return acc;
    const key = `${check.service?.project?.name || "Unknown project"} / ${check.service?.name || "Unknown service"}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const weakestServices = Object.entries(weakServiceMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <Shell>
      <Header title="Dashboard" />
      {loading ? (
        <section className="panel workspace-loading" data-testid="dashboard-loading">
          <div className="loading-pulse" />
          <p>Loading live metrics…</p>
        </section>
      ) : null}
      {!loading && projects.length === 0 && alerts.length === 0 && incidents.length === 0 ? (
        <section className="panel error-panel">
          <EmptyState
            title="No monitoring data visible"
            description={
              sessionOrgMissing
                ? "Your account is signed in but not linked to an organization. Run the production org reconcile script, then sign in again."
                : error
                  ? "Monitoring data could not be loaded for your organization. Check the error below and verify API access."
                  : "No projects, alerts, or incidents exist for your organization yet. Create a project to start monitoring."
            }
            action={<Link className="primary-button" href="/projects">Open projects</Link>}
          />
        </section>
      ) : null}
      {error ? <section className="panel error-panel">{error}</section> : null}

      {!loading && intelligence ? (
        <LearningStateBanner
          state={intelligence.learningState}
          message={intelligence.emptyReason ?? "Predictions are feature disabled; baseline evidence is not predictive output."}
          action={<Link className="text-link" href="/intelligence">Open Intelligence →</Link>}
        />
      ) : null}

      <section className="grid-6 dashboard-metrics">
        <StatCard label="Projects" value={loading ? "-" : projects.length} href="/projects" />
        <StatCard label="Healthy projects" value={loading ? "-" : healthy} href="/projects?health=HEALTHY" />
        <StatCard label="Degraded projects" value={loading ? "-" : degraded} href="/projects?health=DEGRADED" />
        <StatCard label="Down projects" value={loading ? "-" : down} href="/projects?health=DOWN" />
        <StatCard
          label="Open alerts"
          value={loading ? "-" : openAlerts.length}
          href="/alerts?status=OPEN"
        />
        <StatCard
          label="Unresolved incidents"
          value={loading ? "-" : unresolvedIncidents.length}
          href="/incidents?onlyUnresolved=true"
        />
        <StatCard
          label="Failing checks"
          value={loading ? "-" : (checkSummary?.fail ?? "-")}
          href="/checks?latestStatus=FAIL"
        />
        <StatCard
          label="Checks pending"
          value={loading ? "-" : (checkSummary?.pending ?? "-")}
          href="/checks?latestStatus=PENDING"
        />
        <StatCard
          label="Checks with warnings"
          value={loading ? "-" : (checkSummary?.warn ?? "-")}
          href="/checks?latestStatus=WARN"
        />
        <StatCard
          label="Checks tracked"
          value={loading ? "-" : (checkSummary?.total ?? "-")}
          href="/checks"
        />
      </section>

      <PageSection
        title="Live signal credibility"
        description="How much of the dashboard is driven by active operational signals."
        persistKey="org:dashboard:signal-credibility"
      >
        {loading ? <p>Evaluating live signal quality…</p> : (
          <div className="snapshot-grid">
            <div className="snapshot-item">
              <span className="snapshot-label">Active signals</span>
              <strong>{openAlerts.length} open alerts · {unresolvedIncidents.length} unresolved incidents</strong>
            </div>
            <div className="snapshot-item">
              <span className="snapshot-label">Historical excluded</span>
              <strong>{noisyHistoryCount} resolved or historical alert records kept secondary</strong>
            </div>
            <div className="snapshot-item">
              <span className="snapshot-label">Check posture</span>
              <strong>{checkSummary?.pass ?? 0} pass · {checkFailures} fail · {checkWarns} warn · {checkSummary?.pending ?? 0} pending</strong>
            </div>
            {primaryProject ? (
              <div className="snapshot-item snapshot-item-wide">
                <span className="snapshot-label">Fast path</span>
                <strong><Link href={`/projects/${primaryProject.id}`}>Open {primaryProject.name} control room →</Link></strong>
              </div>
            ) : null}
          </div>
        )}
      </PageSection>

      <HealthOverview healthy={healthy} degraded={degraded} down={down} />

      <LayerHealthTable rows={layerHealth} loading={loading} />
      <DashboardAppStatusTable rows={projects} loading={loading} />

      <section className="two-col">
        <RecentAlerts
          items={latestAlerts.map((alert) => ({
            id: alert.id,
            title: alert.title,
            severity: alert.severity,
            status: alert.status,
            projectName: alert.project?.name || "Unknown project",
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
            projectName: incident.project?.name || "Unknown project",
            openedAt: incident.openedAt
          }))}
          resolvedCount={resolvedIncidents.length}
          loading={loading}
        />
      </section>

      <section className="two-col dashboard-secondary">
        <PageSection
          title="Check health snapshot"
          description="Concentrated service failures from active checks."
          persistKey="org:dashboard:check-health"
        >
          {loading ? <p>Loading check health…</p> : (
            <>
              <p>Current checks: {checkSummary?.pass ?? 0} passing, {checkSummary?.fail ?? 0} failing, {checkSummary?.warn ?? 0} warning.</p>
              {weakestServices.length === 0 ? (
                <p>No failing or warning results are present in the loaded check data. This is not an uptime claim.</p>
              ) : (
                <div className="activity-feed">
                  {weakestServices.map(([serviceName, issueCount]) => (
                    <article className="activity-feed-item" key={serviceName}>
                      <div className="activity-feed-title">{serviceName}</div>
                      <p className="activity-feed-meta">{issueCount} active check issue{issueCount === 1 ? "" : "s"}</p>
                    </article>
                  ))}
                </div>
              )}
              <p><Link className="text-link" href="/checks">Open checks page →</Link></p>
            </>
          )}
        </PageSection>

        <PageSection
          title="Operations command"
          description="Automation activity and intelligence posture from real data."
          persistKey="org:dashboard:operations-command"
        >
          {loading ? <p>Loading operations command…</p> : (
            <>
              <div className="snapshot-grid">
                <div className="snapshot-item">
                  <span className="snapshot-label">Automation runs</span>
                  <strong>{intelligence?.counters.automationRuns ?? 0}</strong>
                </div>
                <div className="snapshot-item">
                  <span className="snapshot-label">Deployments tracked</span>
                  <strong>{intelligence?.counters.deployments ?? 0}</strong>
                </div>
                <div className="snapshot-item">
                  <span className="snapshot-label">Displayable patterns</span>
                  <strong>{intelligence?.counters.patternsDisplayable ?? 0}</strong>
                </div>
                <div className="snapshot-item">
                  <span className="snapshot-label">Predictive risk</span>
                  <strong>
                    <StatusBadge label="Feature disabled" tone="muted" title="Phase 9 learning and prediction has not started" />
                  </strong>
                </div>
              </div>
              {(intelligence?.automationHistory ?? []).length === 0 ? (
                <EmptyState title="No recent automation" description="Automation history appears after playbook runs." />
              ) : (
                <div className="activity-feed">
                  {(intelligence?.automationHistory ?? []).slice(0, 4).map((row) => (
                    <article className="activity-feed-item" key={row.id}>
                      <div className="activity-feed-head">
                        <StatusBadge
                          label={row.success == null ? row.status : row.success ? "Success" : "Failed"}
                          tone={row.success === true ? "success" : row.success === false ? "danger" : "neutral"}
                        />
                      </div>
                      <div className="activity-feed-title">
                        <Link href={`/incidents/${row.incidentId}`}>{row.reason || "Automation run"}</Link>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              <p>
                <Link className="text-link" href="/automation">Automation centre →</Link>
                {" · "}
                <Link className="text-link" href="/intelligence">Intelligence →</Link>
              </p>
            </>
          )}
        </PageSection>
      </section>

      <section className="two-col dashboard-secondary">
        <PageSection
          title="Actionable recommendations"
          description="Open insights from product monitoring analysis."
          persistKey="org:dashboard:recommendations"
        >
          {loading ? <p>Loading recommendations…</p> : recommendations.length === 0 ? (
            <EmptyState
              title="No active recommendations"
              description="No open calculated recommendations are available from the loaded evidence. This does not prove monitoring coverage or health."
            />
          ) : (
            <div className="activity-feed">
              {recommendations.map((recommendation) => (
                <article className="activity-feed-item" key={recommendation.id}>
                  <div className="activity-feed-head">
                    <span className="meta-chip">{recommendation.level}</span>
                  </div>
                  <div className="activity-feed-title">{recommendation.title}</div>
                  <p className="activity-feed-meta">{recommendation.projectName}</p>
                  <p>{recommendation.description}</p>
                </article>
              ))}
            </div>
          )}
          <p><Link className="text-link" href="/insights">Open insights page →</Link></p>
        </PageSection>

        <PageSection
          title="Quick links"
          description="Primary operational surfaces."
          persistKey="org:dashboard:quick-links"
          defaultCollapsed
        >
          <div className="snapshot-grid">
            <div className="snapshot-item"><Link href="/incidents">Incidents</Link></div>
            <div className="snapshot-item"><Link href="/alerts">Alerts</Link></div>
            <div className="snapshot-item"><Link href="/automation">Automation</Link></div>
            <div className="snapshot-item"><Link href="/intelligence">Intelligence</Link></div>
            <div className="snapshot-item"><Link href="/accuracy">Accuracy</Link></div>
            <div className="snapshot-item"><Link href="/insights">Insights</Link></div>
          </div>
        </PageSection>
      </section>
    </Shell>
  );
}
