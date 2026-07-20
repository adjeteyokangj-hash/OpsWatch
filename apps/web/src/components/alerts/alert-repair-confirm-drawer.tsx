"use client";

import { FormEvent, useState } from "react";

export type AlertRepairConfirmInput = {
  actionKey: string;
  actionLabel: string;
  diagnosisSummary: string | null;
  riskLevel: string | null;
  approvalRequired: boolean;
  verificationStrategy: string | null;
  whySelected: string | null;
  availabilityReason: string | null;
  oneTimeOverride?: boolean;
};

type Props = {
  open: boolean;
  repair: AlertRepairConfirmInput | null;
  submitting?: boolean;
  onClose: () => void;
  onConfirm: (input: { note: string }) => Promise<void>;
};

export function AlertRepairConfirmDrawer({
  open,
  repair,
  submitting = false,
  onClose,
  onConfirm
}: Props) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open || !repair) return null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await onConfirm({ note: note.trim() });
      setNote("");
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start repair");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose} data-testid="alert-repair-drawer">
      <div
        className="modal-card"
        role="dialog"
        aria-labelledby="alert-repair-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="alert-repair-title">Confirm recommended fix</h2>
        <p className="dashboard-subtle">
          OpsWatch will attempt this repair only after you confirm. The alert stays open until verification
          succeeds.
        </p>

        <dl className="topology-detail-grid">
          <div>
            <dt>Diagnosis</dt>
            <dd>{repair.diagnosisSummary ?? "—"}</dd>
          </div>
          <div>
            <dt>Proposed repair</dt>
            <dd>
              <strong>{repair.actionLabel}</strong>
              <div className="dashboard-subtle">
                <code>{repair.actionKey}</code>
              </div>
            </dd>
          </div>
          <div>
            <dt>Why selected</dt>
            <dd>{repair.whySelected ?? repair.availabilityReason ?? "—"}</dd>
          </div>
          <div>
            <dt>Risk</dt>
            <dd>{repair.riskLevel ?? "—"}</dd>
          </div>
          <div>
            <dt>Approval</dt>
            <dd>
              {repair.oneTimeOverride
                ? "One-time administrator override (project is in Observe / Monitor Only)"
                : repair.approvalRequired
                  ? "Required before execution"
                  : "Not required for this action"}
            </dd>
          </div>
          <div>
            <dt>Verification</dt>
            <dd>{repair.verificationStrategy ?? "NONE"} — OpsWatch will re-check after the repair.</dd>
          </div>
        </dl>

        <form className="stack-form" onSubmit={(event) => void handleSubmit(event)}>
          <label>
            Operator note (optional)
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              placeholder="Context for the audit trail"
            />
          </label>
          {error ? (
            <p className="error-panel" role="alert">
              {error}
            </p>
          ) : null}
          <div className="channel-actions">
            <button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={submitting}
              data-testid="alert-repair-confirm"
            >
              {submitting ? "Starting…" : "Confirm and run"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
