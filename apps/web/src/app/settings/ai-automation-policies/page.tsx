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

type PolicyAreaStatus = "full" | "not_configured" | "not_applicable" | "disabled";

type EffectivePolicyArea = {
  id: string;
  label: string;
  requested: boolean;
  effective: boolean;
  status?: PolicyAreaStatus;
  tone?: "green" | "amber" | "red";
  source: string;
  blocker: string | null;
  href?: string | null;
};

type ReadinessItem = {
  id: string;
  label: string;
  description?: string;
  category?: "platform" | "application" | "ai";
  status?: PolicyAreaStatus;
  applicable?: boolean;
  ok: boolean;
  href: string | null;
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

type ProjectOption = {
  id: string;
  name: string;
  slug?: string;
};

type EffectivePolicySnapshot = {
  asOf: string;
  operatingProfile: string;
  org: {
    requestedMode: string;
    effectiveMode: string;
    enabled: boolean;
  };
  project?: {
    projectId: string;
    requestedMode: string;
    effectiveMode: string;
    emergencyStop: boolean;
    blockedReason: string | null;
  };
  areas: EffectivePolicyArea[];
  policyCoveragePercent?: number;
  readiness: {
    ready: boolean;
    projectId?: string | null;
    monitoringMode?: string | null;
    capabilities?: Record<string, boolean>;
    items: ReadinessItem[];
  };
  allowlist: AllowlistSummary;
  policyHealth: Array<{ id: string; label: string; ok: boolean; status?: PolicyAreaStatus }>;
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

const statusToBadge = (status: PolicyAreaStatus): "success" | "warning" | "danger" | "neutral" => {
  if (status === "full") return "success";
  if (status === "not_configured") return "warning";
  if (status === "disabled") return "neutral";
  return "neutral";
};

const statusLabel = (status: PolicyAreaStatus): string => {
  switch (status) {
    case "full":
      return "Full";
    case "not_configured":
      return "Not configured";
    case "not_applicable":
      return "Not applicable";
    case "disabled":
      return "Disabled";
    default:
      return status;
  }
};

const resolveAreaStatus = (area: EffectivePolicyArea): PolicyAreaStatus => {
  if (area.status) return area.status;
  if (area.tone === "green") return "full";
  if (area.tone === "amber") return "not_configured";
  if (!area.requested) return "disabled";
  return "not_configured";
};

const modeLabel = (mode: string): string =>
  AUTONOMOUS_MODE_LABELS[mode as ProjectAutonomousMode] ?? mode.replace(/_/g, " ");

const areaFixLink = (area: EffectivePolicyArea): string | null => {
  const status = resolveAreaStatus(area);
  if (status !== "not_configured") return null;
  return area.href ?? null;
};

export default function AiAutomationPoliciesPage() {
  const [payload, setPayload] = useState<PoliciesPayload | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [allowlistEntries, setAllowlistEntries] = useState<AllowlistEntry[]>([]);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const [savingCeiling, setSavingCeiling] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ceilingMode, setCeilingMode] = useState<string>("MONITOR_ONLY");

  const load = useCallback(async (projectId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const projectRows = await apiFetch<ProjectOption[]>("/projects").catch(() => []);
      setProjects(projectRows);
      const fromUrl =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("projectId") ?? ""
          : "";
      const queryProjectId = projectId || fromUrl || projectRows[0]?.id || "";
      if (queryProjectId) {
        setSelectedProjectId(queryProjectId);
      }
      const qs = queryProjectId ? `?projectId=${encodeURIComponent(queryProjectId)}` : "";
      const [policiesData, policyData] = await Promise.all([
        apiFetch<PoliciesPayload>(`/settings/ai-automation-policies${qs}`),
        apiFetch<{ allowlist?: AllowlistEntry[] }>("/remediation/policy").catch(() => ({ allowlist: [] }))
      ]);
      setPayload(policiesData);
      setAllowlistEntries(policyData.allowlist ?? []);
      setCeilingMode(policiesData.snapshot.org.requestedMode);
      if (policiesData.snapshot.readiness.projectId && !queryProjectId) {
        setSelectedProjectId(policiesData.snapshot.readiness.projectId);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load AI & automation policies");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSelectProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("projectId", projectId);
      window.history.replaceState({}, "", url.toString());
    }
    void load(projectId);
  };

  const enableAiLed = async () => {
    if (!selectedProjectId || !payload?.snapshot.readiness.ready) return;
    setEnabling(true);
    setError(null);
    try {
      await apiFetch("/settings/ai-automation-policies/enable-ai-led", {
        method: "POST",
        body: JSON.stringify({ projectId: selectedProjectId, projectIds: [selectedProjectId] })
      });
      await load(selectedProjectId);
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
      await load(selectedProjectId);
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
        method: "POST",
        body: JSON.stringify({ projectId: selectedProjectId || undefined })
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
  const coveragePercent =
    snapshot.policyCoveragePercent ??
    Math.round(
      (snapshot.areas.filter((a) => {
        const s = resolveAreaStatus(a);
        return s === "full" || s === "disabled" || s === "not_applicable";
      }).length /
        Math.max(1, snapshot.areas.length)) *
        100
    );
  const notConfiguredItems = readiness.items.filter(
    (i) => (i.status ?? (i.ok ? "full" : "not_configured")) === "not_configured"
  );
  const platformItems = readiness.items.filter((i) => i.category === "platform");
  const applicationItems = readiness.items.filter((i) => i.category === "application");
  const aiItems = readiness.items.filter((i) => i.category === "ai");
  const selectedProjectName =
    projects.find((p) => p.id === selectedProjectId)?.name ?? "Selected application";

  const renderReadinessItems = (items: ReadinessItem[]) =>
    items.length === 0 ? (
      <p className="metric-label">No items in this section.</p>
    ) : (
      <ul className="accuracy-highlight-list">
        {items.map((item) => {
          const status = item.status ?? (item.ok ? "full" : "not_configured");
          const showFix = status === "not_configured" && Boolean(item.href);
          return (
            <li key={item.id} className="accuracy-highlight-item">
              <StatusBadge label={statusLabel(status)} tone={statusToBadge(status)} />
              <span>
                {item.label}
                {item.description ? (
                  <span className="table-subtle" style={{ display: "block", fontSize: "0.75rem" }}>
                    {item.description}
                  </span>
                ) : null}
              </span>
              {showFix && item.href ? (
                <Link href={item.href} className="table-subtle">
                  Fix →
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    );

  return (
    <Shell>
      <Header title="AI & Automation Policies" />
      <p className="dashboard-subtle">
        Capability-driven readiness for a selected application, plus org automation ceiling controls.
      </p>

      <div className="stack-form" style={{ maxWidth: "320px", marginBottom: "8px" }}>
        <label>
          Application
          <select
            value={selectedProjectId}
            onChange={(event) => onSelectProject(event.target.value)}
            data-testid="policy-application-picker"
          >
            {projects.length === 0 ? <option value="">No applications</option> : null}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <section className="panel error-panel">{error}</section> : null}

      {notConfiguredItems.length > 0 ? (
        <section className="suppression-callout suppression-warn" data-testid="not-configured-banner">
          <span className="suppression-icon">⚠</span>
          <div className="suppression-body">
            <p className="suppression-title">Not configured — complete applicable readiness for {selectedProjectName}</p>
            <p className="suppression-detail">
              AI-led enablement stays gated until applicable checklist items pass. Not applicable and disabled
              items do not block readiness.
            </p>
            <ul className="accuracy-highlight-list" style={{ marginTop: "8px" }}>
              {notConfiguredItems.map((item) => (
                <li key={item.id} className="accuracy-highlight-item">
                  <span>{item.label}</span>
                  {item.href ? (
                    <Link href={item.href} className="table-subtle">
                      Fix →
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <PageSection
        title="AI-led operations"
        description="Enable AI-led safe operations for the selected application once applicable readiness passes."
        persistKey="org:ai-automation-policies:master"
        actions={
          <button
            type="button"
            className="primary-button"
            disabled={enabling || !readiness.ready || !selectedProjectId}
            data-action="api"
            data-endpoint="/settings/ai-automation-policies/enable-ai-led"
            onClick={() => void enableAiLed()}
          >
            {enabling ? "Enabling…" : "Enable AI-led safe operations"}
          </button>
        }
      >
        <div className="grid-6" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginTop: "8px" }}>
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
          <div className="stat-card">
            <p className="label">Policy coverage</p>
            <p className="value">{coveragePercent}%</p>
          </div>
        </div>
        {readiness.monitoringMode ? (
          <p className="dashboard-subtle" style={{ marginTop: "8px" }}>
            Selected app monitoring mode: {readiness.monitoringMode}
          </p>
        ) : null}
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
        title="Platform Readiness"
        description="Org-scoped prerequisites for AI-led operations."
        persistKey="org:ai-automation-policies:platform-readiness"
        actions={
          <StatusBadge
            label={readiness.ready ? "Ready" : "Not ready"}
            tone={readiness.ready ? "success" : "warning"}
          />
        }
      >
        {renderReadinessItems(platformItems)}
      </PageSection>

      <PageSection
        title="Application Readiness"
        description={
          readiness.monitoringMode
            ? `Discovery-driven checks for ${selectedProjectName} (${readiness.monitoringMode}).`
            : `Discovery-driven checks for ${selectedProjectName}.`
        }
        persistKey="org:ai-automation-policies:application-readiness"
      >
        {renderReadinessItems(applicationItems)}
      </PageSection>

      <PageSection
        title="AI Readiness"
        description={
          readiness.ready
            ? "All applicable prerequisites met for the selected application."
            : "Complete applicable items before enabling AI-led safe operations."
        }
        persistKey="org:ai-automation-policies:ai-readiness"
      >
        {renderReadinessItems(aiItems)}
      </PageSection>

      <PageSection
        title="Policy areas"
        description="Full / Not configured / Not applicable / Disabled for each AI & automation policy area."
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
            const status = resolveAreaStatus(area);
            const fixHref = areaFixLink(area);
            return (
              <article key={area.id} className="panel" style={{ margin: 0, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginBottom: "8px" }}>
                  <strong style={{ fontSize: "0.9rem" }}>{area.label}</strong>
                  <StatusBadge label={statusLabel(status)} tone={statusToBadge(status)} />
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
