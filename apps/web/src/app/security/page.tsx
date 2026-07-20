"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { ProductTruthStatus } from "../../components/ui/product-truth-status";
import { apiFetch } from "../../lib/api";

type CoverageDimension = {
  dimension: string;
  status: string;
  depth: string;
  evidence: Record<string, unknown>;
};

type CoverageResponse = {
  overallDepth: string;
  honestSummary: string;
  dimensions: CoverageDimension[];
};

type SecurityFinding = {
  id: string;
  ruleName: string;
  ruleKey: string;
  severity: string;
  state: string;
  confidence: number;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  projectId?: string | null;
  recommendedResponse?: string | null;
  relatedIncidentId?: string | null;
  responseStatus?: string | null;
  baselineNote?: string | null;
  evidenceSummaryJson?: Record<string, unknown> | null;
};

type SequenceRow = {
  id: string;
  sequenceType: string;
  confidence: number;
  evidenceLevel: string;
  stage: string;
  likelyEntryPoint?: string | null;
  recommendedContainment?: string | null;
  lastSeenAt: string;
};

export default function SecurityPage() {
  const [coverage, setCoverage] = useState<CoverageResponse | null>(null);
  const [findings, setFindings] = useState<SecurityFinding[]>([]);
  const [sequences, setSequences] = useState<SequenceRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<SecurityFinding | null>(null);
  const [severityFilter, setSeverityFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("OPEN");
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [pending, startTransition] = useTransition();

  const load = () => {
    startTransition(() => {
      void (async () => {
        try {
          setError(null);
          setForbidden(false);
          const params = new URLSearchParams();
          if (stateFilter) params.set("state", stateFilter);
          if (severityFilter) params.set("severity", severityFilter);
          const [coverageRes, findingsRes, sequencesRes] = await Promise.all([
            apiFetch<CoverageResponse>("/security/coverage"),
            apiFetch<{ findings: SecurityFinding[] }>(`/security/findings?${params.toString()}`),
            apiFetch<{ sequences: SequenceRow[] }>("/security/sequences")
          ]);
          setCoverage(coverageRes);
          setFindings(findingsRes.findings || []);
          setSequences(sequencesRes.sequences || []);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to load security workspace";
          if (message.toLowerCase().includes("403") || message.toLowerCase().includes("permission")) {
            setForbidden(true);
          }
          setError(message);
        }
      })();
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateFilter, severityFilter]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    void apiFetch<{ finding: SecurityFinding }>(`/security/findings/${selectedId}`)
      .then((res) => setSelected(res.finding))
      .catch(() => setSelected(findings.find((row) => row.id === selectedId) || null));
  }, [selectedId, findings]);

  const openCount = useMemo(
    () => findings.filter((row) => ["OPEN", "INVESTIGATING", "CONTAINING"].includes(row.state)).length,
    [findings]
  );

  const notConfigured = coverage?.overallDepth === "NONE" || (!coverage && !error);

  return (
    <Shell>
      <Header title="Security" />
      <section className="panel" data-testid="security-workspace">
        <div className="panel-heading-row">
          <div>
            <h2>Security workspace</h2>
            <p className="dashboard-subtle">
              Evidence-based detections and governed response. Not predictive threat modelling.
            </p>
          </div>
          <ProductTruthStatus state="Preview" detail="Phase 8 foundation — deterministic rules only" />
        </div>

        {forbidden ? (
          <p data-testid="security-forbidden">
            Security evidence is restricted. Ordinary Viewer roles cannot access this workspace unless
            explicitly permitted.
          </p>
        ) : null}
        {error && !forbidden ? <p className="dashboard-subtle">{error}</p> : null}
        {pending ? <p className="dashboard-subtle">Refreshing…</p> : null}
      </section>

      <section className="panel" data-testid="security-coverage">
        <h2>Security Coverage</h2>
        {coverage ? (
          <>
            <p data-testid="security-coverage-summary">{coverage.honestSummary}</p>
            <p className="dashboard-subtle">Overall depth: {coverage.overallDepth}</p>
            <ul className="dashboard-list" data-testid="security-coverage-dimensions">
              {coverage.dimensions.map((row) => (
                <li key={row.dimension}>
                  <strong>{row.dimension.replaceAll("_", " ")}</strong> — {row.status} / {row.depth}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p data-testid="security-not-configured">
            {notConfigured
              ? "Security coverage is not configured. URL monitoring alone is not full protection."
              : "Loading coverage…"}
          </p>
        )}
      </section>

      <section className="panel" data-testid="security-findings">
        <div className="panel-heading-row">
          <h2>Findings ({openCount} open in view)</h2>
          <div className="dashboard-actions" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <select
              aria-label="State filter"
              value={stateFilter}
              onChange={(event) => setStateFilter(event.target.value)}
              data-testid="security-state-filter"
            >
              <option value="">All states</option>
              <option value="OPEN">OPEN</option>
              <option value="INVESTIGATING">INVESTIGATING</option>
              <option value="CONTAINING">CONTAINING</option>
              <option value="FALSE_POSITIVE">FALSE_POSITIVE</option>
              <option value="ACCEPTED_RISK">ACCEPTED_RISK</option>
              <option value="SUPPRESSED">SUPPRESSED</option>
            </select>
            <select
              aria-label="Severity filter"
              value={severityFilter}
              onChange={(event) => setSeverityFilter(event.target.value)}
              data-testid="security-severity-filter"
            >
              <option value="">All severities</option>
              <option value="CRITICAL">CRITICAL</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="LOW">LOW</option>
            </select>
            <button type="button" onClick={load}>
              Refresh
            </button>
          </div>
        </div>

        {findings.length === 0 ? (
          <p data-testid="security-findings-empty">
            No persisted security findings. Seeded demo detections are not shown as live evidence.
          </p>
        ) : (
          <ul className="dashboard-list" data-testid="security-findings-list">
            {findings.map((finding) => (
              <li key={finding.id}>
                <button
                  type="button"
                  data-testid={`security-finding-${finding.id}`}
                  onClick={() => setSelectedId(finding.id)}
                  style={{ textAlign: "left", width: "100%" }}
                >
                  <strong>{finding.ruleName}</strong> — {finding.severity} / {finding.state}
                  <br />
                  <span className="dashboard-subtle">
                    {finding.occurrenceCount} occurrence(s) · first {new Date(finding.firstSeenAt).toLocaleString()} ·
                    last {new Date(finding.lastSeenAt).toLocaleString()}
                    {finding.relatedIncidentId ? ` · incident ${finding.relatedIncidentId.slice(0, 8)}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <section className="panel" data-testid="security-finding-detail">
          <h2>Finding detail</h2>
          <p>
            <strong>{selected.ruleName}</strong> ({selected.ruleKey})
          </p>
          <ul className="dashboard-list">
            <li>Severity: {selected.severity}</li>
            <li>State: {selected.state}</li>
            <li>Confidence: {Math.round(selected.confidence * 100)}%</li>
            <li>Occurrences: {selected.occurrenceCount}</li>
            <li>Baseline: {selected.baselineNote || "n/a"}</li>
            <li>Recommended response: {selected.recommendedResponse || "n/a"}</li>
            <li>Response status: {selected.responseStatus || "none"}</li>
            <li>
              Related incident:{" "}
              {selected.relatedIncidentId ? (
                <Link href={`/incidents/${selected.relatedIncidentId}`}>{selected.relatedIncidentId}</Link>
              ) : (
                "none"
              )}
            </li>
          </ul>
          <p className="dashboard-subtle">
            Findings are produced by deterministic rules with matched evidence — not AI prediction.
          </p>
        </section>
      ) : null}

      <section className="panel" data-testid="security-attack-sequences">
        <h2>Threat sequences</h2>
        {sequences.length === 0 ? (
          <p>No correlated attack sequences with sufficient evidence.</p>
        ) : (
          <ul className="dashboard-list">
            {sequences.map((sequence) => (
              <li key={sequence.id} data-testid={`security-sequence-${sequence.id}`}>
                <strong>{sequence.sequenceType}</strong> — {sequence.evidenceLevel} / stage {sequence.stage}
                <br />
                <span className="dashboard-subtle">
                  Entry: {sequence.likelyEntryPoint || "unknown"} · confidence{" "}
                  {Math.round(sequence.confidence * 100)}% · {sequence.recommendedContainment}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Related controls</h2>
        <ul className="dashboard-list">
          <li>
            <Link href="/auto-run-policy">Auto-run policy</Link> — governs autonomous remediation boundaries.
          </li>
          <li>
            <Link href="/settings">Organization settings</Link> — roles and access controls.
          </li>
          <li>
            <Link href="/members">Members &amp; roles</Link> — OpsWatch platform access management.
          </li>
        </ul>
      </section>
    </Shell>
  );
}
