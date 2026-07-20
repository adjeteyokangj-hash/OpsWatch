"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "../../../components/layout/shell";
import { Header } from "../../../components/layout/header";
import { PageSection } from "../../../components/ui/page-section";
import { StatusBadge } from "../../../components/ui/status-badge";
import { EmptyState } from "../../../components/ui/empty-state";
import { apiFetch } from "../../../lib/api";
import {
  AUTONOMOUS_MODE_LABELS,
  type ProjectAutonomousMode
} from "../../../lib/autonomous-mode";

type PolicyAreaTone = "green" | "amber" | "red";

type EffectivePolicyArea = {
  id: string;
  label: string;
  requested: boolean;
  effective: boolean;
  tone: PolicyAreaTone;
  source: string;
  blocker: string | null;
};

type ReadinessItem = {
  id: string;
  label: string;
  ok: boolean;
  href: string;
};

type AllowlistSummary = {
  enabled: boolean;
  actionCount: number;
  autoRunEnabledCount: number;
  actions: string[];
};

type AllowlistEntry = {
  action: string;
  label: string;
  impactTier: string;
  policyTier: string;
  cooldownMinutes: number;
  autoRunEnabled: boolean;
  approvalRequired: boolean;
};

type EffectivePolicySnapshot = {
  asOf: string;
  operatingProfile: string;
  org: {
    requestedMode: string;
    effectiveMode: string;
    enabled: boolean;
  };
  areas: EffectivePolicyArea[];
  readiness: { ready: boolean; items: ReadinessItem[] };
  allowlist: AllowlistSummary;
  policyHealth: Array<{ id: string; label: string; ok: boolean }>;
  blocked: string[];
};

type AuditEvent = {
  id: string;
  eventType: string;
  summary: string;
  actorUserId: string | null;
  createdAt: string;
  detail: unknown;
};

type PoliciesPayload = {
  snapshot: EffectivePolicySnapshot;
  bundle: {
    id: string | null;
    operatingProfile: string;
    status: string;
    updatedAt: string | null;
  };
  audits: AuditEvent[];
};

type SimulationResult = {
  simulatedAt: string;
  incidentCount: number;
  allowlist: string[];
  incidents: Array<{
    incidentId: string;
    title: string;
    severity: string;
    projectName: string;
    candidateActions: Array<{
      action: string;
      label: string;
      autoRunEligible: boolean;
      policyAllowed: boolean;
    }>;
  }>;
};

const ORG_CEILING_MODES = [
  "MONITOR_ONLY",
  "RECOMMEND",
  "AUTO_HEAL_SAFE",
  "FULL_AUTONOMOUS"
] as const;

const toneToBadge = (tone: PolicyAreaTone): "success" | "warning" | "danger" =>
  tone === "green" ? "success" : tone === "amber" ? "warning" : "danger";

const toneLabel = (tone: PolicyAreaTone): string =>
  tone === "green" ? "Active" : tone === "amber" ? "Partial" : "Blocked";

const modeLabel = (mode: string): string =>
  AUTONOMOUS_MODE_LABELS[mode as ProjectAutonomousMode] ?? mode.replace(/_/g, " ");

const AREA_FIX_LINKS: Record<string, string> = {
  operatingProfile: "/settings/ai-automation-policies",
  autonomousExecution: "/auto-run-policy",
  actionPolicies: "/auto-run-policy",
  playbookGovernance: "/workflows",
  simulationReadiness: "/settings/ai-automation-policies",
  modelLifecycleAccuracy: "/accuracy",
  notificationsEscalation: "/settings",
  connectorRemediatorPermissions: "/integrations",
  learningBaselines: "/intelligence",
  anomalyDetection: "/intelligence",
  incidentMatching: "/incidents",
  predictions: "/intelligence",
  recoveryVerification: "/checks"
};

const areaFixLink = (area: EffectivePolicyArea): string | null => {
  if (!area.blocker && area.effective) return null;
  return AREA_FIX_LINKS[area.id] ?? "/settings/ai-automation-policies";
};

export default function AiAutomationPoliciesPage() {
  const [payload, setPayload] = useState<PoliciesPayload | null>(null);
  const [allowlistEntries, setAllowlistEntries] = useState<AllowlistEntry[]>([]);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const [savingCeiling, setSavingCeiling] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ceilingMode, setCeilingMode] = useState<string>("MONITOR_ONLY");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [policiesData, policyData] = await Promise.all([
        apiFetch<PoliciesPayload>("/settings/ai-automation-policies"),
        apiFetch<{ allowlist?: AllowlistEntry[] }>("/remediation/policy").catch(() => ({ allowlist: [] }))
      ]);
      setPayload(policiesData);
      setAllowlistEntries(policyData.allowlist ?? []);
      setCeilingMode(policiesData.snapshot.org.requestedMode);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load AI & automation policies");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const enableAiLed = async () => {
    setEnabling(true);
    setError(null);
    try {
      await apiFetch("/settings/ai-automation-policies/enable-ai-led", { method: "POST" });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to enable AI-led operations");
    } finally {
      setEnabling(false);
    }
  };

  const saveCeiling = async () => {
    setSavingCeiling(true);
    setError(null);
    try {
      await apiFetch("/settings/ai-automation-policies/organization-ceiling", {
        method: "PATCH",
        body: JSON.stringify({ executionMode: ceilingMode })
      });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update organization ceiling");
    } finally {
      setSavingCeiling(false);
    }
  };

  const runSimulation = async () => {
    setSimulating(true);
    setError(null);
    try {
      const result = await apiFetch<SimulationResult>("/settings/ai-automation-policies/simulate", {
        method: "POST"
      });
      setSimulation(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setSimulating(false);
    }
  };

  if (loading) {
    return (
      <Shell>
        <Header title="AI & Automation Policies" />
        <p className="content">Loading…</p>
      </Shell>
    );
  }

  if (!payload) {
    return (
      <Shell>
        <Header title="AI & Automation Policies" />
        <section className="panel error-panel">{error ?? "Policy data unavailable."}</section>
      </Shell>
    );
  }

  const { snapshot, audits } = payload;
  const readiness = snapshot.readiness;
  const orgClamped = snapshot.org.requestedMode !== snapshot.org.effectiveMode;

  return (
    <Shell>
      <Header title="AI & Automation Policies" />
      <p className="dashboard-subtle">
        Organisation-wide AI operating profile, automation ceiling, and policy health. Per-project mode
        overrides live in each application&apos;s automation settings.
      </p>

      {error ? <section className="panel error-panel">{error}</section> : null}

      {!readiness.ready ? (
        <section className="suppression-callout suppression-warn" data-testid="partial-enable-banner">
          <span className="suppression-icon">⚠</span>
          <div className="suppression-body">
            <p className="suppression-title">Partial enable — readiness not satisfied</p>
            <p className="suppression-detail">
              AI-led operations can be configured, but some areas remain blocked until readiness checks pass.
              Complete the checklist below before expecting full autonomous execution.
            </p>
          </div>
        </section>
      ) : null}

      <PageSection
        title="AI-led operations"
        description="Enable the AI-led safe operating profile across your organisation."
        persistKey="org:ai-automation-policies:master"
        actions={
          <button
            type="button"
            className="primary-button"
            disabled={enabling}
            data-action="api"
            data-endpoint="/settings/ai-automation-policies/enable-ai-led"
            onClick={() => void enableAiLed()}
          >
            {enabling ? "Enabling…" : "Enable AI-led operations"}
          </button>
        }
      >
        <div className="grid-6" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: "8px" }}>
          <div className="stat-card">
            <p className="label">Operating profile</p>
            <p className="value">{snapshot.operatingProfile.replace(/_/g, " ")}</p>
          </div>
          <div className="stat-card">
            <p className="label">Org policy</p>
            <p className="value">
              <StatusBadge
                label={snapshot.org.enabled ? "Enabled" : "Disabled"}
                tone={snapshot.org.enabled ? "success" : "neutral"}
              />
            </p>
          </div>
          <div className="stat-card">
            <p className="label">Auto-run actions</p>
            <p className="value">
              {snapshot.allowlist.autoRunEnabledCount}/{snapshot.allowlist.actionCount}
            </p>
          </div>
        </div>
      </PageSection>

      <PageSection
        title="Organisation automation mode"
        description="Requested mode is what you configure; effective mode reflects policy gates and entitlements."
        persistKey="org:ai-automation-policies:org-mode"
      >
        <div className="two-col" style={{ alignItems: "center", gap: "1rem" }}>
          <div>
            <p className="metric-label">Requested mode</p>
            <p style={{ fontWeight: 600, margin: "4px 0 12px" }}>{modeLabel(snapshot.org.requestedMode)}</p>
            <p className="metric-label">Effective mode</p>
            <StatusBadge
              label={modeLabel(snapshot.org.effectiveMode)}
              tone={orgClamped ? "warning" : snapshot.org.enabled ? "success" : "neutral"}
            />
            {orgClamped ? (
              <p className="dashboard-subtle" style={{ marginTop: "8px" }}>
                Effective mode is clamped below the requested ceiling by policy or entitlements.
              </p>
            ) : null}
          </div>
          <div className="stack-form">
            <label>
              Organization ceiling
              <select
                value={ceilingMode}
                onChange={(event) => setCeilingMode(event.target.value)}
              >
                {ORG_CEILING_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {modeLabel(mode)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary-button"
              disabled={savingCeiling || ceilingMode === snapshot.org.requestedMode}
              data-action="api"
              data-endpoint="/settings/ai-automation-policies/organization-ceiling"
              onClick={() => void saveCeiling()}
            >
              {savingCeiling ? "Saving…" : "Update ceiling"}
            </button>
          </div>
        </div>
      </PageSection>

      <PageSection
        title="Readiness checklist"
        description={
          readiness.ready
            ? "All readiness checks passed."
            : "Complete these items before enabling full AI-led execution."
        }
        persistKey="org:ai-automation-policies:readiness"
        actions={
          <StatusBadge
            label={readiness.ready ? "Ready" : "Not ready"}
            tone={readiness.ready ? "success" : "warning"}
          />
        }
      >
        <ul className="accuracy-highlight-list">
          {readiness.items.map((item) => (
            <li key={item.id} className="accuracy-highlight-item">
              <StatusBadge label={item.ok ? "Pass" : "Missing"} tone={item.ok ? "success" : "danger"} />
              <span>{item.label}</span>
              {!item.ok ? (
                <Link href={item.href} className="table-subtle">
                  Fix →
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </PageSection>

      <PageSection
        title="Policy areas"
        description="Requested vs effective state for each AI & automation policy area."
        persistKey="org:ai-automation-policies:areas"
      >
        <div
          className="settings-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "12px",
            marginTop: "12px"
          }}
        >
          {snapshot.areas.map((area) => {
            const fixHref = areaFixLink(area);
            return (
              <article key={area.id} className="panel" style={{ margin: 0, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginBottom: "8px" }}>
                  <strong style={{ fontSize: "0.9rem" }}>{area.label}</strong>
                  <StatusBadge label={toneLabel(area.tone)} tone={toneToBadge(area.tone)} />
                </div>
                <p className="table-subtle" style={{ margin: "4px 0" }}>
                  Requested: {area.requested ? "On" : "Off"} · Effective: {area.effective ? "On" : "Off"}
                </p>
                <p className="table-subtle" style={{ margin: "4px 0", fontSize: "0.75rem" }}>
                  Source: {area.source}
                </p>
                {area.blocker ? (
                  <p className="dashboard-subtle" style={{ margin: "6px 0 0", fontSize: "0.8rem" }}>
                    {area.blocker}
                  </p>
                ) : null}
                {fixHref ? (
                  <Link href={fixHref} className="table-subtle" style={{ display: "inline-block", marginTop: "6px" }}>
                    Fix →
                  </Link>
                ) : null}
              </article>
            );
          })}
        </div>
      </PageSection>

      <PageSection
        title="Action policies"
        description="Safe-action allowlist and per-action auto-run eligibility."
        persistKey="org:ai-automation-policies:allowlist"
        data-testid="action-policies"
        actions={
          <Link href="/auto-run-policy" className="secondary-button">
            Auto-run policy
          </Link>
        }
      >
        {allowlistEntries.length === 0 ? (
          <EmptyState
            title="No action policies"
            description="The remediation allowlist is empty. Configure auto-run policy to define eligible actions."
          />
        ) : (
          <table className="data-table" style={{ marginTop: "12px" }}>
            <thead>
              <tr>
                <th>Action</th>
                <th>Impact</th>
                <th>Policy tier</th>
                <th>Cooldown</th>
                <th>Auto-run</th>
                <th>Approval</th>
              </tr>
            </thead>
            <tbody>
              {allowlistEntries.map((entry) => (
                <tr key={entry.action}>
                  <td style={{ fontWeight: 500 }}>{entry.label ?? entry.action.replace(/_/g, " ")}</td>
                  <td>
                    <span className={`impact-tier-badge impact-tier-${entry.impactTier.toLowerCase()}`}>
                      {entry.impactTier}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`policy-tier-badge ${
                        entry.policyTier === "SAFE_AUTOMATIC"
                          ? "safe"
                          : entry.policyTier === "APPROVAL_REQUIRED"
                            ? "approval"
                            : "manual"
                      }`}
                    >
                      {entry.policyTier.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td>{entry.cooldownMinutes ? `${entry.cooldownMinutes} min` : "—"}</td>
                  <td>
                    <StatusBadge
                      label={entry.autoRunEnabled ? "On" : "Off"}
                      tone={entry.autoRunEnabled ? "success" : "neutral"}
                    />
                  </td>
                  <td>{entry.approvalRequired ? "Required" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PageSection>

      <PageSection
        title="Simulation"
        description="Dry-run candidate auto-remediation actions against open incidents."
        persistKey="org:ai-automation-policies:simulate"
        actions={
          <button
            type="button"
            className="secondary-button"
            disabled={simulating}
            data-action="api"
            data-endpoint="/settings/ai-automation-policies/simulate"
            onClick={() => void runSimulation()}
          >
            {simulating ? "Simulating…" : "Simulate"}
          </button>
        }
      >
        {simulation ? (
          <div style={{ marginTop: "8px" }}>
            <p className="table-subtle">
              Simulated at {new Date(simulation.simulatedAt).toLocaleString()} · {simulation.incidentCount}{" "}
              open incident(s)
            </p>
            {simulation.incidents.length === 0 ? (
              <p className="metric-label">No open incidents to simulate.</p>
            ) : (
              <ul className="accuracy-highlight-list">
                {simulation.incidents.map((inc) => (
                  <li key={inc.incidentId} className="accuracy-highlight-item">
                    <Link href={`/incidents/${inc.incidentId}`}>{inc.title}</Link>
                    <span className="table-subtle">{inc.projectName}</span>
                    <span className="table-subtle">
                      {inc.candidateActions.length} candidate action(s)
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="metric-label">Run a simulation to preview which actions would be eligible on open incidents.</p>
        )}
      </PageSection>

      <PageSection
        title="Emergency stop"
        description="Per-application emergency stop blocks autonomous execution immediately."
        persistKey="org:ai-automation-policies:emergency"
      >
        <div className="suppression-callout suppression-warn" style={{ margin: 0 }}>
          <span className="suppression-icon">⏸</span>
          <div className="suppression-body">
            <p className="suppression-title">Project-level emergency stop</p>
            <p className="suppression-detail">
              Emergency stop is configured per application. Open an application&apos;s{" "}
              <Link href="/projects">automation settings</Link> to enable or clear emergency stop when
              remediation must halt immediately.
            </p>
          </div>
        </div>
      </PageSection>

      <PageSection
        title="Recent policy audits"
        description="Organisation-level changes to AI & automation policy."
        persistKey="org:ai-automation-policies:audits"
        defaultCollapsed={audits.length > 6}
      >
        {audits.length === 0 ? (
          <p className="metric-label">No audit events recorded yet.</p>
        ) : (
          <ul className="accuracy-highlight-list">
            {audits.map((audit) => (
              <li key={audit.id} className="accuracy-highlight-item">
                <span className="table-subtle">{new Date(audit.createdAt).toLocaleString()}</span>
                <span>{audit.summary}</span>
                <span className="pill" style={{ fontSize: "0.7rem" }}>
                  {audit.eventType.replace(/_/g, " ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <p className="dashboard-subtle" style={{ marginTop: "1rem" }}>
        Snapshot as of {new Date(snapshot.asOf).toLocaleString()}. Dataset honesty and executed success rates
        are on the <Link href="/accuracy">Remediation Accuracy</Link> page.
      </p>
    </Shell>
  );
}
