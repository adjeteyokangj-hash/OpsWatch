"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { PageSection } from "../../components/ui/page-section";
import { EmptyState } from "../../components/ui/empty-state";
import { StatCard } from "../../components/dashboard/stat-card";
import { StatusBadge } from "../../components/ui/status-badge";
import { LearningStateBanner } from "../../components/ui/learning-state-banner";
import { apiFetch } from "../../lib/api";

type IntelligenceSnapshot = {
  learningState: "EMPTY" | "LEARNING" | "ACTIVE";
  predictions: {
    enabled: boolean;
    status: string;
    reason: string;
    productEmission: boolean;
  };
  confidenceGates: {
    minDisplayConfidence: number;
    minRecommendationConfidence: number;
  };
  counters: {
    observations: number;
    baselines: number;
    baselinesReady: number;
    patterns: number;
    patternsDisplayable: number;
    incidentMemories: number;
    deployments: number;
    timelineEvents: number;
    automationRuns: number;
    auditEntries: number;
    predictionAccuracyLogs: number;
  };
  recentTimeline: Array<{
    id: string;
    eventType: string;
    summary: string;
    projectId: string | null;
    severity: string | null;
    occurredAt: string;
  }>;
  patterns: Array<{
    id: string;
    patternType: string;
    title: string;
    description: string;
    evidenceCount: number;
    confidenceScore: number;
    displayEligible: boolean;
    lastMatchedAt: string | null;
  }>;
  baselines: Array<{
    id: string;
    scopeType: string;
    scopeKey: string;
    sampleCount: number;
    ready: boolean;
    lastSampleAt: string | null;
  }>;
  deployments: Array<{
    id: string;
    summary: string;
    deployedAt: string;
    version: string | null;
    commitSha: string | null;
    resultingIncidentCount: number;
    resultingAlertCount: number;
  }>;
  automationHistory: Array<{
    id: string;
    incidentId: string;
    status: string;
    triggerType: string | null;
    reason: string | null;
    confidence: number | null;
    success: boolean | null;
    verificationStatus: string | null;
    createdAt: string;
  }>;
  incidentMemories: Array<{
    id: string;
    incidentId: string;
    title: string;
    rootCause: string | null;
    automationInvolved: boolean;
    resolutionTimeMs: number | null;
    resolvedAt: string | null;
  }>;
  predictionReadiness: {
    message: string;
    candidatesStored: number;
    accuracyLogs: number;
  };
  emptyReason: string | null;
};

const formatWhen = (value: string | null | undefined) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

export default function IntelligencePage() {
  const [data, setData] = useState<IntelligenceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const snapshot = await apiFetch<IntelligenceSnapshot>("/intelligence");
        setData(snapshot);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to load intelligence";
        setError(message);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const displayablePatterns = (data?.patterns ?? []).filter((row) => row.displayEligible);
  const learningPatterns = (data?.patterns ?? []).filter((row) => !row.displayEligible);

  return (
    <Shell>
      <Header title="Intelligence" />
      <p className="dashboard-subtle">
        Evidence-based learning from real operations. Predictions stay disabled until confidence thresholds are met.
      </p>

      {loading ? (
        <section className="panel workspace-loading">
          <div className="loading-pulse" />
          <p>Loading intelligence from operational evidence…</p>
        </section>
      ) : null}

      {error ? <section className="panel error-panel">{error}</section> : null}

      {!loading && data ? (
        <>
          <LearningStateBanner
            state={data.learningState}
            message={data.emptyReason ?? data.predictions.reason}
            action={<Link className="text-link" href="/insights">Product insights →</Link>}
          />

          <section className="grid-6 dashboard-metrics">
            <StatCard label="Observations" value={data.counters.observations} />
            <StatCard label="Baselines ready" value={`${data.counters.baselinesReady}/${data.counters.baselines}`} />
            <StatCard label="Patterns (shown)" value={data.counters.patternsDisplayable} />
            <StatCard label="Incident memory" value={data.counters.incidentMemories} href="/incidents" />
            <StatCard label="Deployments" value={data.counters.deployments} />
            <StatCard label="Automation runs" value={data.counters.automationRuns} href="/automation" />
          </section>

          <PageSection
            title="Prediction readiness"
            description="Architecture is installed; product emission is gated off by default."
          >
            <div className="snapshot-grid">
              <div className="snapshot-item">
                <span className="snapshot-label">Feature flag</span>
                <strong>
                  <StatusBadge
                    label={data.predictions.enabled ? "OPSWATCH_PREDICTIONS_ENABLED=true" : "Disabled"}
                    tone={data.predictions.enabled ? "warning" : "muted"}
                  />
                </strong>
              </div>
              <div className="snapshot-item">
                <span className="snapshot-label">Status</span>
                <strong>{data.predictions.status}</strong>
              </div>
              <div className="snapshot-item snapshot-item-wide">
                <span className="snapshot-label">Why</span>
                <strong>{data.predictionReadiness.message}</strong>
              </div>
              <div className="snapshot-item">
                <span className="snapshot-label">Accuracy logs</span>
                <strong>{data.counters.predictionAccuracyLogs} (empty until predictions enabled)</strong>
              </div>
              <div className="snapshot-item">
                <span className="snapshot-label">Confidence gates</span>
                <strong>
                  display ≥ {data.confidenceGates.minDisplayConfidence} · recommend ≥{" "}
                  {data.confidenceGates.minRecommendationConfidence}
                </strong>
              </div>
            </div>
          </PageSection>

          <section className="two-col">
            <PageSection title="Learning baselines" description="Accumulated from checks, recoveries, and traffic facts.">
              {data.baselines.length === 0 ? (
                <EmptyState
                  title="No baselines yet"
                  description="Baselines appear after heartbeats, checks, and recoveries accumulate evidence."
                />
              ) : (
                <div className="activity-feed">
                  {data.baselines.map((row) => (
                    <article className="activity-feed-item" key={row.id}>
                      <div className="activity-feed-head">
                        <StatusBadge label={row.ready ? "Ready" : "Learning"} tone={row.ready ? "success" : "info"} />
                        <span className="meta-chip">{row.scopeType}</span>
                      </div>
                      <div className="activity-feed-title">{row.scopeKey}</div>
                      <p className="activity-feed-meta">
                        {row.sampleCount} samples · last {formatWhen(row.lastSampleAt)}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </PageSection>

            <PageSection
              title="Patterns with evidence"
              description="Only display-eligible patterns are treated as actionable; others remain stored while learning."
            >
              {displayablePatterns.length === 0 ? (
                <EmptyState
                  title="No display-ready patterns"
                  description={
                    learningPatterns.length
                      ? `${learningPatterns.length} pattern(s) stored below the confidence threshold.`
                      : "Repeated failures and deploy correlations will appear when evidence is strong enough."
                  }
                />
              ) : (
                <div className="activity-feed">
                  {displayablePatterns.map((row) => (
                    <article className="activity-feed-item" key={row.id}>
                      <div className="activity-feed-head">
                        <StatusBadge label={`${Math.round(row.confidenceScore * 100)}%`} tone="success" />
                        <span className="meta-chip">{row.patternType}</span>
                      </div>
                      <div className="activity-feed-title">{row.title}</div>
                      <p>{row.description}</p>
                      <p className="activity-feed-meta">{row.evidenceCount} evidence samples</p>
                    </article>
                  ))}
                </div>
              )}
              {learningPatterns.length > 0 ? (
                <details className="intelligence-details">
                  <summary>Stored below threshold ({learningPatterns.length})</summary>
                  <ul className="intelligence-muted-list">
                    {learningPatterns.map((row) => (
                      <li key={row.id}>
                        {row.title} · {Math.round(row.confidenceScore * 100)}% · {row.evidenceCount} samples
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </PageSection>
          </section>

          <section className="two-col">
            <PageSection title="Operations timeline" description="Chronological factual events for this organization.">
              {data.recentTimeline.length === 0 ? (
                <EmptyState title="Timeline is empty" description="Deployments, alerts, automation, and baseline updates will land here." />
              ) : (
                <div className="activity-feed">
                  {data.recentTimeline.slice(0, 15).map((row) => (
                    <article className="activity-feed-item" key={row.id}>
                      <div className="activity-feed-head">
                        <span className="meta-chip">{row.eventType}</span>
                        {row.severity ? <StatusBadge label={row.severity} tone="warning" /> : null}
                      </div>
                      <div className="activity-feed-title">{row.summary}</div>
                      <p className="activity-feed-meta">{formatWhen(row.occurredAt)}</p>
                    </article>
                  ))}
                </div>
              )}
            </PageSection>

            <PageSection title="Incident memory" description="Permanent retention of known resolution facts only.">
              {data.incidentMemories.length === 0 ? (
                <EmptyState title="No incident memories" description="Resolved incidents with recorded diagnosis will appear here." />
              ) : (
                <div className="activity-feed">
                  {data.incidentMemories.map((row) => (
                    <article className="activity-feed-item" key={row.id}>
                      <div className="activity-feed-title">
                        <Link href={`/incidents/${row.incidentId}`}>{row.title}</Link>
                      </div>
                      <p className="activity-feed-meta">
                        {row.rootCause ? `Root cause: ${row.rootCause}` : "Root cause not recorded"}
                        {row.automationInvolved ? " · automation involved" : ""}
                      </p>
                      <p className="activity-feed-meta">Resolved {formatWhen(row.resolvedAt)}</p>
                    </article>
                  ))}
                </div>
              )}
            </PageSection>
          </section>

          <section className="two-col">
            <PageSection title="Deployment intelligence" description="Deployments correlated with resulting incidents/alerts in-window.">
              {data.deployments.length === 0 ? (
                <EmptyState title="No deployments recorded" description="Change events and deploy webhooks populate this list." />
              ) : (
                <div className="activity-feed">
                  {data.deployments.map((row) => (
                    <article className="activity-feed-item" key={row.id}>
                      <div className="activity-feed-title">{row.summary}</div>
                      <p className="activity-feed-meta">
                        {formatWhen(row.deployedAt)}
                        {row.version ? ` · ${row.version}` : ""}
                        {row.commitSha ? ` · ${row.commitSha.slice(0, 7)}` : ""}
                      </p>
                      <p className="activity-feed-meta">
                        {row.resultingIncidentCount} incident(s) · {row.resultingAlertCount} alert(s) in correlation window
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </PageSection>

            <PageSection title="Automation history" description="Trigger, reason, success, and verification from real runs.">
              {data.automationHistory.length === 0 ? (
                <EmptyState title="No automation history" description="Planned and executed automation runs will appear here." />
              ) : (
                <div className="activity-feed">
                  {data.automationHistory.map((row) => (
                    <article className="activity-feed-item" key={row.id}>
                      <div className="activity-feed-head">
                        <StatusBadge
                          label={row.success == null ? row.status : row.success ? "Success" : "Failed"}
                          tone={row.success === true ? "success" : row.success === false ? "danger" : "neutral"}
                        />
                        {row.triggerType ? <span className="meta-chip">{row.triggerType}</span> : null}
                      </div>
                      <div className="activity-feed-title">
                        <Link href={`/incidents/${row.incidentId}`}>Incident {row.incidentId.slice(0, 8)}</Link>
                      </div>
                      <p>{row.reason || "No reason recorded"}</p>
                      <p className="activity-feed-meta">
                        {formatWhen(row.createdAt)}
                        {row.confidence != null ? ` · confidence ${Math.round(row.confidence * 100)}%` : ""}
                        {row.verificationStatus ? ` · verify ${row.verificationStatus}` : ""}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </PageSection>
          </section>
        </>
      ) : null}
    </Shell>
  );
}
