"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AUTONOMOUS_MODE_DESCRIPTIONS,
  AUTONOMOUS_MODE_LABELS,
  PROJECT_AUTONOMOUS_MODES,
  type ProjectAutonomousMode,
  type ProjectAutonomousModeState
} from "../../lib/autonomous-mode";
import { apiFetch } from "../../lib/api";

type Props = {
  projectId: string;
  compact?: boolean;
  onUpdated?: (state: ProjectAutonomousModeState) => void;
};

const modeTone = (mode: ProjectAutonomousMode): string => {
  if (mode === "DISABLED") return "topology-mode-badge--observe";
  if (mode === "MONITOR_ONLY") return "topology-mode-badge--observe";
  if (mode === "RECOMMEND") return "topology-mode-badge--approval";
  if (mode === "AUTO_HEAL_SAFE") return "topology-mode-badge--autonomous";
  return "topology-mode-badge--autonomous";
};

const modeDot = (mode: ProjectAutonomousMode): string => {
  if (mode === "DISABLED") return "topology-mode-dot--observe";
  if (mode === "MONITOR_ONLY") return "topology-mode-dot--observe";
  if (mode === "RECOMMEND") return "topology-mode-dot--approval";
  if (mode === "AUTO_HEAL_SAFE") return "topology-mode-dot--autonomous";
  return "topology-mode-dot--autonomous";
};

export function AutonomousModeBadge({ mode }: { mode: ProjectAutonomousMode }) {
  return (
    <span
      className={`topology-automation-mode-badge ${modeTone(mode)}`}
      data-testid="topology-automation-mode-badge"
      data-mode={mode}
    >
      <span className={`topology-mode-dot ${modeDot(mode)}`} aria-hidden="true" />
      <span>{AUTONOMOUS_MODE_LABELS[mode]}</span>
    </span>
  );
}

export function AutonomousModeControl({ projectId, compact: _compact = false, onUpdated }: Props) {
  const [state, setState] = useState<ProjectAutonomousModeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch<ProjectAutonomousModeState>(`/projects/${projectId}/automation-mode`);
      setState(payload);
      onUpdated?.(payload);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load autonomous mode");
    } finally {
      setLoading(false);
    }
  }, [projectId, onUpdated]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveMode = async (mode: ProjectAutonomousMode) => {
    setSaving(true);
    setError(null);
    try {
      const payload = await apiFetch<ProjectAutonomousModeState>(`/projects/${projectId}/automation-mode`, {
        method: "PATCH",
        body: JSON.stringify({ mode })
      });
      setState(payload);
      onUpdated?.(payload);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update autonomous mode");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="dashboard-subtle">Loading autonomous mode…</p>;
  }
  if (!state) {
    return error ? <p className="error-panel">{error}</p> : null;
  }

  const effective = state.effectiveMode;
  const requested = state.requestedMode;
  const isClamped = requested !== effective;
  const blockedReason = state.policyGates.blockedReason;

  return (
    <div className="topology-detail-section" data-testid="autonomous-mode-control">
      <div
        className="autonomous-mode-status-row"
        style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginBottom: "0.75rem", alignItems: "center" }}
      >
        <div>
          <p className="metric-label" style={{ margin: 0 }}>
            Requested mode
          </p>
          <p style={{ margin: "2px 0 0", fontWeight: 600 }}>{AUTONOMOUS_MODE_LABELS[requested]}</p>
        </div>
        <div>
          <p className="metric-label" style={{ margin: 0 }}>
            Effective mode
          </p>
          <div style={{ marginTop: "2px" }}>
            <AutonomousModeBadge mode={effective} />
          </div>
        </div>
      </div>

      {error ? <p className="error-panel">{error}</p> : null}
      {isClamped ? (
        <p className="topology-observe-blocked-note" data-testid="autonomous-mode-clamped-note" role="status">
          Requested mode differs from effective mode — automation is not fully active at the requested level.
        </p>
      ) : null}
      {blockedReason ? (
        <p className="topology-observe-blocked-note" data-testid="autonomous-mode-policy-note" role="status">
          {blockedReason}{" "}
          <Link href="/settings/ai-automation-policies">Open organisation policy</Link>
        </p>
      ) : null}
      {state.remediationEmergencyDisabled ? (
        <p className="topology-observe-blocked-note" role="status">
          Remediation emergency stop is active — execution is blocked until cleared in project settings.
        </p>
      ) : null}

      <fieldset className="autonomous-mode-options" disabled={saving}>
        <legend className="sr-only">Autonomous mode</legend>
        {PROJECT_AUTONOMOUS_MODES.map((mode) => {
          const disabled =
            (mode === "FULL_AUTONOMOUS" && !state.policyGates.canEscalateToFullAutonomous) ||
            (mode === "AUTO_HEAL_SAFE" && !state.policyGates.canEscalateToAutoHeal) ||
            ((mode === "RECOMMEND" || mode === "AUTO_HEAL_SAFE" || mode === "FULL_AUTONOMOUS") &&
              !state.policyGates.approvalEntitled &&
              !state.policyGates.autonomousEntitled);
          return (
            <label
              key={mode}
              className={`autonomous-mode-option${state.requestedMode === mode ? " is-selected" : ""}`}
              data-testid={`autonomous-mode-option-${mode.toLowerCase()}`}
            >
              <input
                type="radio"
                name="autonomous-mode"
                value={mode}
                checked={state.requestedMode === mode}
                disabled={disabled}
                onChange={() => void saveMode(mode)}
              />
              <span className="autonomous-mode-option-body">
                <strong>{AUTONOMOUS_MODE_LABELS[mode]}</strong>
                <span className="dashboard-subtle">{AUTONOMOUS_MODE_DESCRIPTIONS[mode]}</span>
                {disabled ? (
                  <span className="dashboard-subtle">Not available on your current plan or policy.</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}

export async function patchProjectAutonomousMode(
  projectId: string,
  mode: ProjectAutonomousMode
): Promise<ProjectAutonomousModeState> {
  return apiFetch<ProjectAutonomousModeState>(`/projects/${projectId}/automation-mode`, {
    method: "PATCH",
    body: JSON.stringify({ mode })
  });
}
