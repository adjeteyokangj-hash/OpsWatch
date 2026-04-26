"use client";

import React, { useEffect, useState } from "react";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
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
  cooldownMs: number | null;
  impactTier: string;
  policyTier: string;
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

function formatCooldown(ms: number | null): string {
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

  return (
    <Shell>
      <Header title="Auto-Run Policy" />

      {/* ── Explainer ──────────────────────────────────────────────── */}
      <section className="panel">
        <h2>Controlled Auto-Remediation</h2>
        <p className="metric-label" style={{ marginBottom: "8px" }}>
          Phase 9 rollout: auto-run is restricted to a narrow safe-action allowlist only.
          All three levels must permit execution — global, project, and action policies.
          Cooldown protection prevents action thrashing. HIGH-impact actions cannot auto-run.
        </p>
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
      </section>

      {/* ── Global switch ──────────────────────────────────────────── */}
      <section className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2>Global Auto-Run</h2>
            <p className="metric-label">Master switch for the entire organisation.</p>
          </div>
          <button
            className={`policy-toggle ${globalEnabled ? "policy-toggle-on" : "policy-toggle-off"}`}
            disabled={saving === "GLOBAL:"}
            data-action="api"
            data-endpoint="/remediation/policy"
            onClick={() => toggle("GLOBAL", "", globalEnabled)}
          >
            {saving === "GLOBAL:" ? "Saving…" : globalEnabled ? "Enabled — click to disable" : "Disabled — click to enable"}
          </button>
        </div>
      </section>

      {/* ── Per-action switches ────────────────────────────────────── */}
      <section className="panel">
        <h2>Action Policies</h2>
        <p className="metric-label">Fine-grained control per safe-allowlist action.</p>
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
            {(data?.allowlist ?? []).map((entry) => {
              const actionPolicy = getPolicy("ACTION", entry.action);
              const enabled = actionPolicy?.enabled ?? false;
              const isEligible = entry.policyTier !== "MANUAL_ONLY";
              const saveKey = `ACTION:${entry.action}`;
              return (
                <tr key={entry.action}>
                  <td style={{ fontWeight: 500 }}>{entry.action.replace(/_/g, " ")}</td>
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
                  <td>{formatCooldown(entry.cooldownMs)}</td>
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
      </section>

      {/* ── Per-project switches ───────────────────────────────────── */}
      {projects.length > 0 && (
        <section className="panel">
          <h2>Project Policies</h2>
          <p className="metric-label">Override auto-run per project. Disabled projects block all auto-runs for their incidents/services.</p>
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
        </section>
      )}
    </Shell>
  );
}
