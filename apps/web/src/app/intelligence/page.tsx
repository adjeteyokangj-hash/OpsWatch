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
import { ProductTruthStatus } from "../../components/ui/product-truth-status";
import { apiFetch } from "../../lib/api";

type LearningStage = {
  key: string;
  envVar: string;
  enabled: boolean;
  defaultEnabled: boolean;
  description: string;
};

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
    projectId: string | null;
    summary: string;
    deployedAt: string;
    version: string | null;
    commitSha: string | null;
    branch: string | null;
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
  phase9?: {
    learningStages: LearningStage[];
    metricBaselines: Array<{
      id: string;
      projectId: string | null;
      environment: string;
      metricKey: string;
      sampleCount: number;
      mean: number | null;
      p95: number | null;
      confidenceLabel: string;
      dataQualityState: string;
      lastRecalculatedAt: string;
      freshness: string;
    }>;
    anomalies: Array<{
      id: string;
      projectId: string | null;
      metricKey: string;
      method: string;
      severity: string;
      observedValue: number;
      expectedMin: number | null;
      expectedMax: number | null;
      deviation: number | null;
      explanation: string;
      baselineConfidence: number;
      lastDetectedAt: string;
    }>;
    deterioration: Array<{
      projectId: string;
      metricKey: string;
      windows: number;
      startValue: number;
      endValue: number;
      explanation: string;
      confidenceLabel: string;
    }>;
    incidentPatterns: Array<{
      id: string;
      fingerprint: string;
      title: string;
      confirmedRootCause: string | null;
      recurrenceCount: number;
      lastSeenAt: string;
    }>;
    predictionCandidates: Array<{
      id: string;
      predictionType: string;
      title: string;
      summary: string;
      confidenceScore: number;
      confidenceLabel: string;
      reviewState: string;
      forecastHorizonMs: number | null;
      expiresAt: string | null;
      recommendedAction: string | null;
      evidenceJson: unknown;
      relatedIncidentId: string | null;
    }>;
    preventiveRecommendations: Array<{
      actionKey: string;
      recommendationConfidence: number;
      successCount: number;
      failureCount: number;
      riskLevel: string;
      note: string;
    }>;
    outcomeLearning: {
      evaluated: number;
      materialised: number;
      prevented: number;
      falsePositiveRate: number | null;
      precision: number | null;
      note: string;
    };
    securityRiskPatterns: Array<{
      id: string;
      metricKey: string;
      sampleCount: number;
      mean: number | null;
      confidenceLabel: string;
      wording: string;
    }>;
  };
  emptyReason: string | null;
};

type FeatureGate = {
  key: string;
  envVar: string;
  enabled: boolean;
  defaultEnabled: boolean;
  description: string;
};

const formatWhen = (value: string | null | undefined) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const horizonLabel = (ms: number | null | undefined) => {
  if (!ms) return "—";
  const hours = Math.round(ms / (60 * 60 * 1000));
  return hours >= 24 ? `${Math.round(hours / 24)}d` : `${hours}h`;
};

export default function IntelligencePage() {
  const [data, setData] = useState<IntelligenceSnapshot | null>(null);
  const [gates, setGates] = useState<FeatureGate[]>([]);
  const [learningStages, setLearningStages] = useState<LearningStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      // Skip on-read harvest — worker learning cycle owns writes; keeps UI reads light.
      const [snapshot, gatePayload] = await Promise.all([
        apiFetch<IntelligenceSnapshot>("/intelligence?harvest=false"),
        apiFetch<{ gates: FeatureGate[]; learningStages?: LearningStage[] }>(
          "/intelligence/feature-gates"
        ).catch(() => ({ gates: [], learningStages: [] }))
      ]);
      setData(snapshot);
      setGates(gatePayload.gates ?? []);
      setLearningStages(gatePayload.learningStages ?? snapshot.phase9?.learningStages ?? []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load intelligence";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const reviewPrediction = async (predictionId: string, action: string) => {
    setReviewBusy(predictionId);
    try {
      await apiFetch(`/intelligence/predictions/${predictionId}/review`, {
        method: "POST",
        body: JSON.stringify({ action, note: `UI ${action}` })
      });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setReviewBusy(null);
    }
  };

  const displayablePatterns = (data?.patterns ?? []).filter((row) => row.displayEligible);
  const learningPatterns = (data?.patterns ?? []).filter((row) => !row.displayEligible);
  const phase9 = data?.phase9;
  const predictionsOff = !data?.predictions.enabled;

  return (
    <Shell>
      <Header title="Intelligence" />
      <p className="dashboard-subtle">
        Evidence-based learning: baselines, anomalies, incident memory, and gated prediction candidates.
        OpsWatch does not guarantee failures or attacks before they happen.
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
            <StatCard label="Metric baselines" value={phase9?.metricBaselines.length ?? 0} />
            <StatCard label="Open anomalies" value={phase9?.anomalies.length ?? 0} />
            <StatCard label="Prediction candidates" value={data.predictionReadiness.candidatesStored} />
            <StatCard label="Incident memory" value={data.counters.incidentMemories} href="/incidents" />
          </section>

          <PageSection
            title="Prediction readiness"
            description="Generation stays default-off. Candidates require evidence, expiry, and review for high impact."
          >
            <div className="snapshot-grid" data-testid="predictions-disabled-state">
              <div className="snapshot-item">
                <span className="snapshot-label">Product state</span>
                <strong>
                  <ProductTruthStatus
                    state={predictionsOff ? "Feature disabled" : "Preview"}
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
                <span className="snapshot-label">Live prediction candidates</span>
                <strong data-testid="prediction-candidate-count">
                  {data.predictionReadiness.candidatesStored}
                </strong>
              </div>
            </div>
          </PageSection>

          {learningStages.length > 0 ? (
            <PageSection
              title="Learning stages"
              description="Separate flags. Stages default OFF; the UI never invents hidden predictions."
            >
              <div className="feature-gate-grid" data-testid="learning-stages">
                {learningStages.map((stage) => (
                  <article className="feature-gate-card" key={stage.key}>
                    <strong>{stage.key.replace(/_/g, " ")}</strong>
                    <StatusBadge
                      label={stage.enabled ? "Enabled" : "Off"}
                      tone={stage.enabled ? "warning" : "muted"}
                    />
                    <p className="dashboard-subtle">{stage.description}</p>
                    <p className="dashboard-subtle mono-meta">{stage.envVar}</p>
                  </article>
                ))}
              </div>
            </PageSection>
          ) : null}

          {gates.length > 0 ? (
            <PageSection title="Capability gates" description="Broader platform gates (defaults OFF).">
              <div className="feature-gate-grid">
                {gates.map((gate) => (
                  <article className="feature-gate-card" key={gate.key}>
                    <strong>{gate.key.replace(/_/g, " ")}</strong>
                    <StatusBadge
                      label={gate.enabled ? "Enabled" : "Off"}
                      tone={gate.enabled ? "warning" : "muted"}
                    />
                    <p className="dashboard-subtle">{gate.description}</p>
                  </article>
                ))}
              </div>
            </PageSection>
          ) : null}

          <section className="two-col">
            <PageSection
              title="Baselines"
              description="Metric baselines from live checks and APM windows. Insufficient samples stay labelled."
            >
              {(phase9?.metricBaselines.length ?? 0) === 0 ? (
                <EmptyState
                  title="No metric baselines yet"
                  description="Enable BASELINE_CALCULATION and accumulate live evidence. Fixture/demo projects are excluded."
                />
              ) : (
                <div className="activity-feed" data-testid="baseline-overview">
                  {phase9!.metricBaselines.map((row) => (
                    <article className="activity-feed-item" key={row.id} data-testid="baseline-detail">
                      <div className="activity-feed-head">
                        <StatusBadge label={row.confidenceLabel} tone="info" />
                        <span className="meta-chip">{row.metricKey}</span>
                        <span className="meta-chip">{row.freshness}</span>
                      </div>
                      <div className="activity-feed-title">
                        {row.environment} · n={row.sampleCount}
                      </div>
                      <p className="activity-feed-meta">
                        mean {row.mean?.toFixed?.(3) ?? "—"} · p95 {row.p95?.toFixed?.(3) ?? "—"} ·{" "}
                        {row.dataQualityState} · {formatWhen(row.lastRecalculatedAt)}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </PageSection>

            <PageSection
              title="Current anomalies"
              description="Deterministic above-normal detections — not predictions."
            >
              {(phase9?.anomalies.length ?? 0) === 0 ? (
                <EmptyState
                  title="No open anomalies"
                  description="Anomaly detection stays off until ANOMALY_DETECTION is enabled with ready baselines."
                />
              ) : (
                <div className="activity-feed" data-testid="anomaly-list">
                  {phase9!.anomalies.map((row) => (
                    <article className="activity-feed-item" key={row.id} data-testid="anomaly-detail">
                      <div className="activity-feed-head">
                        <StatusBadge label={row.severity} tone="warning" />
                        <span className="meta-chip">{row.method}</span>
                      </div>
                      <div className="activity-feed-title">{row.metricKey}</div>
                      <p>{row.explanation}</p>
                      <p className="activity-feed-meta">
                        observed {row.observedValue} · expected [{row.expectedMin ?? "—"},{" "}
                        {row.expectedMax ?? "—"}] · {formatWhen(row.lastDetectedAt)}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </PageSection>
          </section>

          <section className="two-col">
            <PageSection title="Deteriorating services" description="Sustained multi-window worsening only.">
              {(phase9?.deterioration.length ?? 0) === 0 ? (
                <EmptyState title="No deterioration detected" description="Requires sustained rising trends across windows." />
              ) : (
                <div className="activity-feed" data-testid="deterioration">
                  {phase9!.deterioration.map((row, index) => (
                    <article className="activity-feed-item" key={`${row.projectId}-${row.metricKey}-${index}`}>
                      <div className="activity-feed-title">
                        {row.metricKey} · {row.confidenceLabel}
                      </div>
                      <p>{row.explanation}</p>
                      <p className="activity-feed-meta">
                        {row.startValue.toFixed(3)} → {row.endValue.toFixed(3)} over {row.windows} windows
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </PageSection>

            <PageSection
              title="Similar incidents / pattern memory"
              description="Confirmed root-cause patterns only. Similarity ≠ same cause."
            >
              {(phase9?.incidentPatterns.length ?? 0) === 0 ? (
                <EmptyState
                  title="No confirmed patterns"
                  description="Resolved incidents with known root cause populate pattern memory when matching is enabled."
                />
              ) : (
                <div className="activity-feed" data-testid="similar-incidents">
                  {phase9!.incidentPatterns.map((row) => (
                    <article className="activity-feed-item" key={row.id}>
                      <div className="activity-feed-title">{row.title}</div>
                      <p className="activity-feed-meta">
                        recurrence {row.recurrenceCount} · {row.confirmedRootCause ?? "—"} ·{" "}
                        {formatWhen(row.lastSeenAt)}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </PageSection>
          </section>

          <PageSection
            title="Prediction candidates"
            description="Future operational risk only. Each row has evidence and expiry. High-impact items need review."
          >
            {(phase9?.predictionCandidates.length ?? 0) === 0 ? (
              <EmptyState
                title={predictionsOff ? "Predictions disabled" : "No candidates"}
                description={
                  predictionsOff
                    ? "OPSWATCH_PREDICTIONS_ENABLED is not true. No silent generation."
                    : "Candidates appear only from live evidence above confidence thresholds."
                }
              />
            ) : (
              <div className="activity-feed" data-testid="prediction-candidate">
                {phase9!.predictionCandidates.map((row) => (
                  <article className="activity-feed-item" key={row.id} data-testid="prediction-evidence">
                    <div className="activity-feed-head">
                      <StatusBadge label={row.reviewState} tone="info" />
                      <span className="meta-chip">{row.predictionType}</span>
                      <span className="meta-chip">{row.confidenceLabel}</span>
                    </div>
                    <div className="activity-feed-title">{row.title}</div>
                    <p>{row.summary}</p>
                    <p className="activity-feed-meta">
                      horizon {horizonLabel(row.forecastHorizonMs)} · expires {formatWhen(row.expiresAt)} ·
                      action {row.recommendedAction ?? "—"}
                    </p>
                    <details>
                      <summary>Evidence</summary>
                      <pre className="mono-meta">{JSON.stringify(row.evidenceJson, null, 2)}</pre>
                    </details>
                    <div className="button-row">
                      <button
                        type="button"
                        data-testid="review-confirm"
                        disabled={reviewBusy === row.id}
                        onClick={() => void reviewPrediction(row.id, "confirm")}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        data-testid="review-dismiss"
                        disabled={reviewBusy === row.id}
                        onClick={() => void reviewPrediction(row.id, "dismiss")}
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        disabled={reviewBusy === row.id}
                        onClick={() => void reviewPrediction(row.id, "mark_materialised")}
                      >
                        Materialised
                      </button>
                      <button
                        type="button"
                        disabled={reviewBusy === row.id}
                        onClick={() => void reviewPrediction(row.id, "mark_prevented")}
                      >
                        Prevented
                      </button>
                      <button
                        type="button"
                        disabled={reviewBusy === row.id}
                        onClick={() => void reviewPrediction(row.id, "mark_false_positive")}
                      >
                        False positive
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </PageSection>

          <section className="two-col">
            <PageSection
              title="Preventive recommendations"
              description="Low-risk Phase 7 registry actions only. Not autonomous high-risk execution."
            >
              {(phase9?.preventiveRecommendations.length ?? 0) === 0 ? (
                <EmptyState
                  title="No preventive recommendations"
                  description="Requires PREVENTIVE_RECOMMENDATIONS and ≥2 verified successes for an action."
                />
              ) : (
                <div className="activity-feed" data-testid="preventive-recommendation">
                  {phase9!.preventiveRecommendations.map((row) => (
                    <article className="activity-feed-item" key={row.actionKey}>
                      <div className="activity-feed-title">{row.actionKey}</div>
                      <p className="activity-feed-meta">
                        confidence {Math.round(row.recommendationConfidence * 100)}% · success{" "}
                        {row.successCount} · fail {row.failureCount} · {row.riskLevel}
                      </p>
                      <p>{row.note}</p>
                    </article>
                  ))}
                </div>
              )}
            </PageSection>

            <PageSection title="Outcome learning" description="Organisation-scoped evaluation metrics.">
              <div className="snapshot-grid" data-testid="outcome-metrics">
                <div className="snapshot-item">
                  <span className="snapshot-label">Evaluated</span>
                  <strong>{phase9?.outcomeLearning.evaluated ?? 0}</strong>
                </div>
                <div className="snapshot-item" data-testid="materialised-outcome">
                  <span className="snapshot-label">Materialised</span>
                  <strong>{phase9?.outcomeLearning.materialised ?? 0}</strong>
                </div>
                <div className="snapshot-item" data-testid="prevented-outcome">
                  <span className="snapshot-label">Prevented</span>
                  <strong>{phase9?.outcomeLearning.prevented ?? 0}</strong>
                </div>
                <div className="snapshot-item" data-testid="false-positive">
                  <span className="snapshot-label">False-positive rate</span>
                  <strong>
                    {phase9?.outcomeLearning.falsePositiveRate == null
                      ? "n/a"
                      : phase9.outcomeLearning.falsePositiveRate}
                  </strong>
                </div>
                <div className="snapshot-item snapshot-item-wide">
                  <span className="snapshot-label">Note</span>
                  <strong>{phase9?.outcomeLearning.note ?? "—"}</strong>
                </div>
              </div>
            </PageSection>
          </section>

          <PageSection
            title="Security risk patterns"
            description="Elevated / above-normal wording only — never predicted breach certainty."
          >
            {(phase9?.securityRiskPatterns.length ?? 0) === 0 ? (
              <EmptyState title="No security baselines" description="Built from Phase 8 security event volumes when baselines run." />
            ) : (
              <div className="activity-feed" data-testid="security-risk-pattern">
                {phase9!.securityRiskPatterns.map((row) => (
                  <article className="activity-feed-item" key={row.id}>
                    <div className="activity-feed-title">{row.metricKey}</div>
                    <p>{row.wording}</p>
                    <p className="activity-feed-meta">
                      n={row.sampleCount} · mean {row.mean?.toFixed?.(3) ?? "—"} · {row.confidenceLabel}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </PageSection>

          <section className="two-col" data-testid="mobile-intelligence">
            <PageSection title="Calculated patterns" description="Evidence-ranked correlations are not predictions.">
              {displayablePatterns.length === 0 ? (
                <EmptyState
                  title="No display-ready patterns"
                  description={
                    learningPatterns.length
                      ? `${learningPatterns.length} pattern(s) below threshold.`
                      : "Patterns appear when evidence is strong enough."
                  }
                />
              ) : (
                <div className="activity-feed">
                  {displayablePatterns.map((row) => (
                    <article className="activity-feed-item" key={row.id}>
                      <div className="activity-feed-title">{row.title}</div>
                      <p>{row.description}</p>
                    </article>
                  ))}
                </div>
              )}
            </PageSection>

            <PageSection title="Incident memory" description="Known resolution facts only.">
              {data.incidentMemories.length === 0 ? (
                <EmptyState title="No incident memories" description="Resolved incidents with diagnosis appear here." />
              ) : (
                <div className="activity-feed">
                  {data.incidentMemories.map((row) => (
                    <article className="activity-feed-item" key={row.id}>
                      <div className="activity-feed-title">
                        <Link href={`/incidents/${row.incidentId}`}>{row.title}</Link>
                      </div>
                      <p className="activity-feed-meta">
                        {row.rootCause ? `Root cause: ${row.rootCause}` : "Root cause not recorded"}
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
