"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { PageSection } from "../../components/ui/page-section";
import { apiFetch } from "../../lib/api";

type PolicyRow = {
  id: string;
  policyType: "GLOBAL" | "PROJECT" | "ACTION";
  policyKey: string;
  enabled: boolean;
  updatedBy: string | null;
  updatedAt: string;
};

type AllowlistEntry = {
  action: string;
  label?: string;
  cooldownMs?: number | null;
  cooldownMinutes?: number;
  impactTier: string;
  policyTier: string;
  autoRunEnabled?: boolean;
  approvalRequired?: boolean;
};

type PolicyData = {
  policies: PolicyRow[];
  allowlist: AllowlistEntry[];
};

type Project = { id: string; name: string; clientName: string; environment: string };

const COOLDOWN_LABEL: Record<number, string> = {
  300000:  "5 min",
  600000:  "10 min",
  900000:  "15 min",
  1200000: "20 min",
  1800000: "30 min",
};

function formatCooldown(entry: AllowlistEntry): string {
  if (entry.cooldownMinutes != null) {
    return `${entry.cooldownMinutes} min`;
  }
  const ms = entry.cooldownMs ?? null;
  if (!ms) return "—";
  return COOLDOWN_LABEL[ms] ?? `${Math.round(ms / 60000)} min`;
}

export default function AutoRunPolicyPage() {
  const [data, setData] = useState<PolicyData | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [policyData, projectList] = await Promise.all([
        apiFetch<PolicyData>("/remediation/policy"),
        apiFetch<Project[]>("/projects"),
      ]);
      setData(policyData);
      setProjects(projectList);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load policy settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const toggle = async (policyType: "GLOBAL" | "PROJECT" | "ACTION", policyKey: string, current: boolean) => {
    const key = `${policyType}:${policyKey}`;
    setSaving(key);
    try {
      await apiFetch("/remediation/policy", {
        method: "PUT",
        body: JSON.stringify({ policyType, policyKey, enabled: !current }),
      });
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Failed to save policy");
    } finally {
      setSaving(null);
    }
  };

  const getPolicy = (policyType: string, policyKey: string): PolicyRow | undefined =>
    data?.policies.find((p) => p.policyType === policyType && p.policyKey === policyKey);

  if (loading) {
    return (
      <Shell>
        <Header title="Auto-Run Policy" />
        <p className="content">Loading…</p>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <Header title="Auto-Run Policy" />
        <section className="panel error-panel">{error}</section>
      </Shell>
    );
  }

  const globalPolicy  = getPolicy("GLOBAL", "");
  const globalEnabled = globalPolicy?.enabled ?? false;

  const allowlist = data?.allowlist ?? [];

  return (
    <Shell>
      <Header title="Auto-Run Policy" />
      <p className="dashboard-subtle">
        <Link href="/settings/ai-automation-policies">Open AI &amp; Automation Policies →</Link>
      </p>

      {/* ── Explainer ──────────────────────────────────────────────── */}
      <PageSection
        title="Controlled Auto-Remediation"
        description="Phase 9 rollout: auto-run is restricted to a narrow safe-action allowlist only. All three levels must permit execution — global, project, and action policies. Cooldown protection prevents action thrashing. HIGH-impact actions cannot auto-run."
        persistKey="org:auto-run-policy:explainer"
      >
        <div className="suppression-callout suppression-warn" style={{ margin: 0 }}>
          <span className="suppression-icon">⚠</span>
          <div className="suppression-body">
            <p className="suppression-title">Safe-action allowlist only</p>
            <p className="suppression-detail">
              Only rerun-check, retry-webhook, and diagnostic actions are eligible.
              Restart, rotate secret, rollback, and disable integration remain manual or approval-only.
            </p>
          </div>
        </div>
        <p className="metric-label" style={{ marginTop: "12px" }}>
          Organisation-wide AI operating profile, readiness, and ceiling controls live in the{" "}
          <Link href="/settings/ai-automation-policies">AI &amp; Automation Policy Centre</Link>.
          Dataset honesty and executed success rates are on the{" "}
          <Link href="/accuracy">Remediation Accuracy</Link> page, not here.
        </p>
      </PageSection>

      {/* ── Global switch ──────────────────────────────────────────── */}
      <PageSection
        title="Global Auto-Run"
        description="Master switch for the entire organisation."
        persistKey="org:auto-run-policy:global"
        actions={
          <button
            className={`policy-toggle ${globalEnabled ? "policy-toggle-on" : "policy-toggle-off"}`}
            disabled={saving === "GLOBAL:"}
            data-action="api"
            data-endpoint="/remediation/policy"
            onClick={() => toggle("GLOBAL", "", globalEnabled)}
          >
            {saving === "GLOBAL:" ? "Saving…" : globalEnabled ? "Enabled — click to disable" : "Disabled — click to enable"}
          </button>
        }
      >
        <p className="metric-label">
          When disabled, no project or action policy can auto-run remediations.
        </p>
      </PageSection>

      {/* ── Per-action switches ────────────────────────────────────── */}
      <PageSection
        title="Action Policies"
        description="Fine-grained control per safe-allowlist action."
        persistKey="org:auto-run-policy:actions"
      >
        {allowlist.length === 0 ? (
          <p className="metric-label" style={{ marginTop: "12px" }}>
            No actions on the allowlist yet. Configure global auto-run or review the{" "}
            <Link href="/settings/ai-automation-policies">Policy Centre</Link>.
          </p>
        ) : (
        <table className="data-table" style={{ marginTop: "12px" }}>
          <thead>
            <tr>
              <th>Action</th>
              <th>Impact</th>
              <th>Policy Tier</th>
              <th>Cooldown</th>
              <th>Auto-Run</th>
            </tr>
          </thead>
          <tbody>
            {allowlist.map((entry) => {
              const actionPolicy = getPolicy("ACTION", entry.action);
              const enabled = actionPolicy?.enabled ?? false;
              const isEligible = entry.policyTier !== "MANUAL_ONLY";
              const saveKey = `ACTION:${entry.action}`;
              return (
                <tr key={entry.action}>
                  <td style={{ fontWeight: 500 }}>{entry.label ?? entry.action.replace(/_/g, " ")}</td>
                  <td>
                    <span className={`impact-tier-badge impact-tier-${entry.impactTier.toLowerCase()}`}>
                      {entry.impactTier}
                    </span>
                  </td>
                  <td>
                    <span className={`policy-tier-badge ${
                      entry.policyTier === "SAFE_AUTOMATIC" ? "safe" :
                      entry.policyTier === "APPROVAL_REQUIRED" ? "approval" : "manual"
                    }`}>
                      {entry.policyTier.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td>{formatCooldown(entry)}</td>
                  <td>
                    <button
                      className={`policy-toggle policy-toggle-sm ${enabled ? "policy-toggle-on" : "policy-toggle-off"}`}
                      disabled={saving === saveKey || !isEligible}
                      data-action="api"
                      data-endpoint="/remediation/policy"
                      onClick={() => toggle("ACTION", entry.action, enabled)}
                    >
                      {isEligible ? (saving === saveKey ? "…" : enabled ? "On" : "Off") : "Not eligible"}
                    </button>
                    {!isEligible ? <div className="table-subtle">Manual-only action cannot auto-run</div> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </PageSection>

      {/* ── Per-project switches ───────────────────────────────────── */}
      {projects.length > 0 && (
        <PageSection
          title="Project Policies"
          description="Override auto-run per project. Disabled projects block all auto-runs for their incidents/services."
          persistKey="org:auto-run-policy:projects"
          defaultCollapsed
        >
          <table className="data-table" style={{ marginTop: "12px" }}>
            <thead>
              <tr>
                <th>Project</th>
                <th>Client</th>
                <th>Environment</th>
                <th>Auto-Run</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((proj) => {
                const projPolicy = getPolicy("PROJECT", proj.id);
                const enabled = projPolicy?.enabled ?? false;
                const saveKey = `PROJECT:${proj.id}`;
                return (
                  <tr key={proj.id}>
                    <td style={{ fontWeight: 500 }}>{proj.name}</td>
                    <td>{proj.clientName}</td>
                    <td>
                      <span className="pill" style={{ background: proj.environment === "production" ? "#f9ddda" : "#d9f2e6", color: proj.environment === "production" ? "var(--down)" : "var(--healthy)", fontSize: "0.75rem" }}>
                        {proj.environment}
                      </span>
                    </td>
                    <td>
                      <button
                        className={`policy-toggle policy-toggle-sm ${enabled ? "policy-toggle-on" : "policy-toggle-off"}`}
                        disabled={saving === saveKey}
                        data-action="api"
                        data-endpoint="/remediation/policy"
                        onClick={() => toggle("PROJECT", proj.id, enabled)}
                      >
                        {saving === saveKey ? "…" : enabled ? "On" : "Off"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PageSection>
      )}
    </Shell>
  );
}
