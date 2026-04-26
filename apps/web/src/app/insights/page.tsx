"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { StatCard } from "../../components/dashboard/stat-card";
import { apiFetch } from "../../lib/api";

type CoverageItem = {
  key: string;
  label: string;
  covered: boolean;
  source: string | null;
  recommendation: string;
};

type CriticalPathStep = {
  key: string;
  label: string;
  covered: boolean;
  recommendedCheck: string;
};

type SyntheticJourney = {
  name: string;
  mode: string;
  recommendation: string;
};

type ConnectionProfile = {
  type: string;
  enabled: boolean;
  monitors: string[];
  attachedCount: number;
};

type RootCause = {
  severity: "LOW" | "MEDIUM" | "HIGH";
  title: string;
  summary: string;
  contributingSignals: string[];
};

type BusinessImpact = {
  alertId: string;
  title: string;
  severity: string;
  area: string;
  score: number;
  summary: string;
};

type RemediationLearning = {
  action: string;
  suggestedCount: number;
  executedCount: number;
  succeededCount: number;
  failedCount: number;
  successRate: number;
  failureRate: number;
  averageTimeSavedMinutes: number;
  lastEnvironment: string | null;
  impactTier: string | null;
};

type InsightRecommendation = {
  id: string;
  projectId: string;
  type: string;
  targetKey: string;
  title: string;
  description: string;
  level: "SAFE_AUTO_APPLY" | "MANUAL_APPLY" | "APPROVAL_REQUIRED";
  status: string;
  expectedCoverageGain: number;
  actionLabel: string;
  source: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  applyType: string;
  expectedOutcome: string;
  mostImportantWarning: string;
  previewItems: string[];
};

type InsightUserRef = {
  id: string;
  name: string;
  email: string;
};

type InsightActionRun = {
  id: string;
  projectId: string;
  insightRecommendationId: string | null;
  actionType: string;
  status: string;
  requestedById: string | null;
  approvedById: string | null;
  resultJson: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  requestedBy: InsightUserRef | null;
  approvedBy: InsightUserRef | null;
  resultSummary: string | null;
};

type InsightActionHistory = {
  id: string;
  projectId: string;
  message: string;
  createdAt: string;
  payloadJson: {
    recommendationId?: string;
    recommendationType?: string;
    targetKey?: string;
    level?: string;
    status?: string;
  } | null;
};

type ProjectInsight = {
  id: string;
  name: string;
  status: string;
  openAlertCount: number;
  latestHeartbeatAt: string | null;
  coverage: CoverageItem[];
  coverageScore: number;
  criticalPaths: CriticalPathStep[];
  syntheticJourneys: SyntheticJourney[];
  connectionProfiles: ConnectionProfile[];
  rootCause: RootCause;
  businessImpact: BusinessImpact[];
  deepDiagnostics: string[];
  recommendations: InsightRecommendation[];
};

type ProductInsights = {
  generatedAt: string;
  portfolio: {
    projects: number;
    averageCoverage: number;
    openBusinessRisks: number;
    activeCorrelations: number;
  };
  projects: ProjectInsight[];
  remediationLearning: RemediationLearning[];
  actionHistory: InsightActionHistory[];
};

const severityClass = (severity: string) => {
  if (severity === "HIGH" || severity === "CRITICAL") return "fail";
  if (severity === "MEDIUM") return "warn";
  return "pass";
};

export default function InsightsPage() {
  const [data, setData] = useState<ProductInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionRuns, setActionRuns] = useState<InsightActionRun[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [historyFocusId, setHistoryFocusId] = useState<string | null>(null);

  const loadInsights = async () => {
    setLoading(true);
    setError(null);
    try {
      const [insightsResponse, actionRunsResponse] = await Promise.all([
        apiFetch<ProductInsights>("/insights/product"),
        apiFetch<{ actionRuns: InsightActionRun[] }>("/insights/action-runs")
      ]);
      setData(insightsResponse);
      setActionRuns(actionRunsResponse.actionRuns);
      setSelectedProjectId((current) => current || insightsResponse.projects[0]?.id || "");
    } catch (err: any) {
      setError(err?.message || "Failed to load insights");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadInsights();
  }, []);

  useEffect(() => {
    setHistoryFocusId(null);
  }, [selectedProjectId]);

  const selectedProject = useMemo(() => {
    if (!data) return null;
    return data.projects.find((project) => project.id === selectedProjectId) || data.projects[0] || null;
  }, [data, selectedProjectId]);

  const applyRecommendation = async (recommendation: InsightRecommendation, approve = false) => {
    setApplyingId(recommendation.id);
    setError(null);
    setMessage(null);
    try {
      const result = await apiFetch<{ status: string }>(`/insights/recommendations/${recommendation.id}/apply`, {
        method: "POST",
        body: JSON.stringify({
          projectId: recommendation.projectId,
          approve
        })
      });
      setMessage(
        result.status === "PENDING_APPROVAL"
          ? "Recommendation logged for approval."
          : "Recommendation applied."
      );
      await loadInsights();
    } catch (err: any) {
      setError(err?.message || "Failed to apply recommendation");
    } finally {
      setApplyingId(null);
    }
  };

  const dismissRecommendation = async (recommendation: InsightRecommendation) => {
    setDismissingId(recommendation.id);
    setError(null);
    setMessage(null);
    try {
      await apiFetch<{ status: string }>(`/insights/recommendations/${recommendation.id}/dismiss`, {
        method: "POST",
        body: JSON.stringify({ projectId: recommendation.projectId })
      });
      setMessage("Recommendation dismissed.");
      await loadInsights();
    } catch (err: any) {
      setError(err?.message || "Failed to dismiss recommendation");
    } finally {
      setDismissingId(null);
    }
  };

  const sortedRecommendations = selectedProject
    ? [...selectedProject.recommendations]
        .sort((a, b) => {
          const order = { SAFE_AUTO_APPLY: 0, MANUAL_APPLY: 1, APPROVAL_REQUIRED: 2 };
          return order[a.level] - order[b.level];
        })
    : [];

  const selectedProjectActionRuns = useMemo(() => {
    if (!selectedProject) return [];
    return actionRuns.filter((run) => {
      if (run.projectId !== selectedProject.id) return false;
      if (historyFocusId && run.insightRecommendationId !== historyFocusId) return false;
      return true;
    });
  }, [actionRuns, historyFocusId, selectedProject]);

  const levelLabel = (level: InsightRecommendation["level"]) => {
    if (level === "SAFE_AUTO_APPLY") return "Safe auto-apply";
    if (level === "APPROVAL_REQUIRED") return "Approval required";
    return "Manual apply";
  };

  const riskClass = (riskLevel: InsightRecommendation["riskLevel"]) => {
    if (riskLevel === "HIGH") return "fail";
    if (riskLevel === "MEDIUM") return "warn";
    return "pass";
  };

  const actionStatusClass = (status: string) => {
    if (status === "COMPLETED" || status === "APPLIED") return "pass";
    if (status === "FAILED") return "fail";
    if (status === "PENDING_APPROVAL" || status === "DISMISSED") return "warn";
    return "unknown";
  };

  const actionTypeLabel = (value: string) => value.replace(/_/g, " ").toLowerCase();

  return (
    <Shell>
      <Header title="Insights" />
      {error ? <section className="panel error-panel">{error}</section> : null}
      {message ? <section className="panel success-panel">{message}</section> : null}

      <section className="three-col">
        <StatCard label="Coverage" value={loading ? "-" : `${data?.portfolio.averageCoverage ?? 0}%`} />
        <StatCard label="Business risks" value={loading ? "-" : data?.portfolio.openBusinessRisks ?? 0} href="/alerts?status=OPEN" />
        <StatCard label="Correlations" value={loading ? "-" : data?.portfolio.activeCorrelations ?? 0} href="/incidents" />
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Product intelligence</h2>
            <p>Coverage, risks, correlations, and actions that improve resilience.</p>
          </div>
          <select
            aria-label="Select project"
            value={selectedProjectId}
            onChange={(event) => setSelectedProjectId(event.target.value)}
          >
            {(data?.projects || []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        {loading ? <p>Loading insights...</p> : null}
        {!loading && !selectedProject ? <p>No project insights available yet.</p> : null}
      </section>

      {selectedProject ? (
        <>
          <section className="two-col settings-grid">
            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>Coverage map</h2>
                  <p>{selectedProject.coverageScore}% of key monitoring areas covered.</p>
                </div>
                <Link className="secondary-button" href={`/projects/${selectedProject.id}`}>
                  Open project
                </Link>
              </div>
              <div className="insight-list">
                {selectedProject.coverage.map((item) => (
                  <article key={item.key} className="insight-row">
                    <span className={`result-pill ${item.covered ? "pass" : "warn"}`}>
                      {item.covered ? "COVERED" : "GAP"}
                    </span>
                    <div>
                      <strong>{item.label}</strong>
                      <p>{item.covered ? item.source : item.recommendation}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>Risks</h2>
                  <p>Owner-facing business impact from open alerts.</p>
                </div>
              </div>
              {selectedProject.businessImpact.length === 0 ? (
                <p>No open business-impact risks for this project.</p>
              ) : (
                <div className="insight-list">
                  {selectedProject.businessImpact.map((impact) => (
                    <article key={impact.alertId} className="insight-row">
                      <span className={`result-pill ${impact.score >= 85 ? "fail" : "warn"}`}>
                        {impact.score}
                      </span>
                      <div>
                        <strong>{impact.area}: {impact.title}</strong>
                        <p>{impact.summary}</p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </section>

          <section className="two-col settings-grid">
            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>Correlations</h2>
                  <p>Current linked failures and likely causes.</p>
                </div>
                <span className={`result-pill ${severityClass(selectedProject.rootCause.severity)}`}>
                  {selectedProject.rootCause.severity}
                </span>
              </div>
              <h3>{selectedProject.rootCause.title}</h3>
              <p>{selectedProject.rootCause.summary}</p>
              <ul className="compact-list">
                {selectedProject.rootCause.contributingSignals.map((signal) => (
                  <li key={signal}>{signal}</li>
                ))}
              </ul>
            </section>

            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>Recommended actions</h2>
                  <p>Executable fixes with safety levels.</p>
                </div>
              </div>
              {sortedRecommendations.length === 0 ? (
                <p>No open recommendations for this project.</p>
              ) : (
                <div className="recommendation-list">
                  {sortedRecommendations.map((recommendation) => (
                    <article key={recommendation.id} className="recommendation-card">
                      <div className="channel-head">
                        <strong>{recommendation.title}</strong>
                        <div className="recommendation-badges">
                          <span className={`result-pill ${riskClass(recommendation.riskLevel)}`}>
                            {recommendation.riskLevel} risk
                          </span>
                          <span className={`result-pill ${recommendation.level === "SAFE_AUTO_APPLY" ? "pass" : recommendation.level === "APPROVAL_REQUIRED" ? "fail" : "warn"}`}>
                            {levelLabel(recommendation.level)}
                          </span>
                        </div>
                      </div>
                      <p>{recommendation.description}</p>
                      <p className="table-subtle">{recommendation.expectedOutcome}</p>
                      <div className="profile-grid recommendation-preview-grid">
                        <article className="profile-card">
                          <strong>Creates</strong>
                          <ul className="compact-list">
                            {recommendation.previewItems.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </article>
                        <article className="profile-card">
                          <strong>Outcome preview</strong>
                          <p><span className="table-subtle">Apply type:</span> {levelLabel(recommendation.level)}</p>
                          <p><span className="table-subtle">Coverage gain:</span> +{recommendation.expectedCoverageGain}%</p>
                          <p><span className="table-subtle">Source:</span> {actionTypeLabel(recommendation.source)}</p>
                          <p><span className="table-subtle">Warning:</span> {recommendation.mostImportantWarning}</p>
                        </article>
                      </div>
                      <div className="channel-actions">
                        <span className="table-subtle">{recommendation.applyType.replace(/_/g, " ").toLowerCase()}</span>
                        {recommendation.level === "APPROVAL_REQUIRED" ? (
                          <>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => void applyRecommendation(recommendation, false)}
                              disabled={applyingId === recommendation.id}
                            >
                              Request approval
                            </button>
                            <button
                              type="button"
                              className="primary-button"
                              onClick={() => void applyRecommendation(recommendation, true)}
                              disabled={applyingId === recommendation.id}
                            >
                              Approve and apply
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className={recommendation.level === "SAFE_AUTO_APPLY" ? "primary-button" : "secondary-button"}
                            onClick={() => void applyRecommendation(recommendation, true)}
                            disabled={applyingId === recommendation.id}
                          >
                            {applyingId === recommendation.id ? "Applying..." : recommendation.actionLabel}
                          </button>
                        )}
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => setHistoryFocusId(recommendation.id)}
                          disabled={loading}
                          title="Show history for this recommendation"
                        >
                          View history
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => void dismissRecommendation(recommendation)}
                          disabled={dismissingId === recommendation.id || applyingId === recommendation.id}
                          title="Dismiss this recommendation"
                        >
                          {dismissingId === recommendation.id ? "Dismissing..." : "Dismiss"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </section>

          <section className="two-col settings-grid">
            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>Critical paths</h2>
                  <p>Monitor business journeys, not only isolated endpoints.</p>
                </div>
              </div>
              <div className="journey-flow">
                {selectedProject.criticalPaths.map((step, index) => (
                  <article key={step.key} className="journey-step">
                    <span className={`result-pill ${step.covered ? "pass" : "warn"}`}>
                      {index + 1}
                    </span>
                    <div>
                      <strong>{step.label}</strong>
                      <p>{step.covered ? "Signal found in checks, events, or integrations." : step.recommendedCheck}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>Synthetic templates</h2>
                  <p>Journey definitions ready to turn into browser checks.</p>
                </div>
              </div>
              {selectedProject.syntheticJourneys.length === 0 ? (
                <p>All standard synthetic journey templates have at least one signal.</p>
              ) : (
                <div className="insight-list">
                  {selectedProject.syntheticJourneys.map((journey) => (
                    <article key={`${journey.mode}:${journey.name}`} className="insight-row">
                      <span className="result-pill unknown">{journey.mode}</span>
                      <div>
                        <strong>{journey.name}</strong>
                        <p>{journey.recommendation}</p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </section>

          <section className="two-col settings-grid">
            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>Connection profiles</h2>
                  <p>Provider-aware monitoring that should appear after connecting once.</p>
                </div>
                <Link className="secondary-button" href="/settings">
                  Manage integrations
                </Link>
              </div>
              {selectedProject.connectionProfiles.length === 0 ? (
                <p>No provider profiles are connected yet.</p>
              ) : (
                <div className="profile-grid">
                  {selectedProject.connectionProfiles.map((profile) => (
                    <article key={profile.type} className="profile-card">
                      <div className="channel-head">
                        <strong>{profile.type}</strong>
                        <span className={`result-pill ${profile.enabled ? "pass" : "warn"}`}>
                          {profile.enabled ? "ENABLED" : "DRAFT"}
                        </span>
                      </div>
                      <p>{profile.attachedCount} named monitor(s) already attached.</p>
                      <ul className="compact-list">
                        {profile.monitors.map((monitor) => (
                          <li key={monitor}>{monitor}</li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>Deep diagnostics</h2>
                  <p>Extra inspection mode for incidents and active alert windows.</p>
                </div>
              </div>
              <ul className="diagnostic-list">
                {selectedProject.deepDiagnostics.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          </section>

          <section className="two-col settings-grid">
            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>Remediation learning</h2>
                  <p>Success rates, failures, and time saved by action.</p>
                </div>
                <Link className="secondary-button" href="/accuracy">
                  Accuracy
                </Link>
              </div>
              {data?.remediationLearning.length ? (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Suggested</th>
                        <th>Executed</th>
                        <th>Success</th>
                        <th>Time saved</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.remediationLearning.slice(0, 8).map((row) => (
                        <tr key={row.action}>
                          <td>{row.action.replace(/_/g, " ")}</td>
                          <td>{row.suggestedCount}</td>
                          <td>{row.executedCount}</td>
                          <td>{row.successRate}%</td>
                          <td>{row.averageTimeSavedMinutes}m</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>No remediation history yet.</p>
              )}
            </section>

            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>Action history</h2>
                  <p>Persisted action runs for this project, including who triggered them and what changed.</p>
                </div>
                {historyFocusId ? (
                  <button type="button" className="secondary-button" onClick={() => setHistoryFocusId(null)}>
                    Clear filter
                  </button>
                ) : null}
              </div>
              {selectedProjectActionRuns.length ? (
                <div className="insight-list">
                  {selectedProjectActionRuns.slice(0, 8).map((entry) => (
                    <article key={entry.id} className="insight-row">
                      <span className={`result-pill ${actionStatusClass(entry.status)}`}>
                        {entry.status}
                      </span>
                      <div>
                        <strong>{actionTypeLabel(entry.actionType)}</strong>
                        <p>
                          Triggered by {entry.requestedBy?.name || entry.requestedBy?.email || entry.requestedById || "unknown user"}
                          {entry.approvedBy ? `, approved by ${entry.approvedBy.name || entry.approvedBy.email}` : ""}
                        </p>
                        <p>{new Date(entry.createdAt).toLocaleString()}</p>
                        {entry.resultSummary ? <p>{entry.resultSummary}</p> : null}
                        {entry.errorMessage ? <p>{entry.errorMessage}</p> : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p>{historyFocusId ? "No persisted runs exist for this recommendation yet." : "No insight actions have been run yet."}</p>
              )}
            </section>
          </section>
        </>
      ) : null}
    </Shell>
  );
}
