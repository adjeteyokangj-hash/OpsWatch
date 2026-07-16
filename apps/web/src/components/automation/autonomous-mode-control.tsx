"use client";

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

export function AutonomousModeControl({ projectId, compact = false, onUpdated }: Props) {
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
  const isClamped = state.requestedMode !== state.effectiveMode;

  return (
    <section className="topology-detail-section" data-testid="autonomous-mode-control">
      <div className="section-head">
        <div>
          <h2>{compact ? "Autonomous mode" : "Autonomous remediation mode"}</h2>
          <p className="dashboard-subtle">
            Controls how OpsWatch plans and executes repairs for this application.
          </p>
        </div>
        <AutonomousModeBadge mode={effective} />
      </div>

      {error ? <p className="error-panel">{error}</p> : null}
      {isClamped && state.policyGates.blockedReason ? (
        <p className="topology-observe-blocked-note" data-testid="autonomous-mode-policy-note" role="status">
          {state.policyGates.blockedReason} Effective mode: {AUTONOMOUS_MODE_LABELS[effective]}.
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
    </section>
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
