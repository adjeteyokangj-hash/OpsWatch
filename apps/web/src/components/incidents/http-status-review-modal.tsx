"use client";

import { FormEvent, useState } from "react";
import type { SuggestedAction } from "./incident-diagnosis-types";

type Preview = {
  checkName?: string;
  serviceName?: string;
  currentExpectedStatus?: number | null;
  recentActualStatus?: number | null;
  proposedExpectedStatus?: number | null;
  riskExplanation?: string;
  recentResults?: Array<{
    status: string;
    responseCode: number | null;
    message: string;
    checkedAt: string;
  }>;
};

type Props = {
  action: SuggestedAction;
  incidentId: string;
  serviceId?: string;
  checkId?: string;
  onClose: () => void;
  onSubmit: (input: {
    newExpectedStatusCode: number;
    approvalReason: string;
  }) => Promise<void>;
};

export function HttpStatusReviewModal({
  action,
  incidentId,
  serviceId,
  checkId,
  onClose,
  onSubmit
}: Props) {
  const preview = (action.preview ?? {}) as Preview;
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const proposed =
    typeof preview.proposedExpectedStatus === "number"
      ? preview.proposedExpectedStatus
      : typeof preview.recentActualStatus === "number"
        ? preview.recentActualStatus
        : null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!proposed) {
      setError("No proposed HTTP status is available from recent check results.");
      return;
    }
    if (!reason.trim()) {
      setError("Approval reason is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ newExpectedStatusCode: proposed, approvalReason: reason.trim() });
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to apply expected status change");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card http-status-review-modal"
        role="dialog"
        aria-labelledby="http-status-review-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="http-status-review-title">{action.label}</h2>
        <p className="dashboard-subtle">{action.description}</p>

        <div className="http-status-review-grid">
          <div>
            <p className="metric-label">Check</p>
            <p>{preview.checkName ?? "HTTP check"}</p>
          </div>
          <div>
            <p className="metric-label">Monitored area</p>
            <p>{preview.serviceName ?? serviceId ?? "—"}</p>
          </div>
          <div>
            <p className="metric-label">Current expected</p>
            <p>{preview.currentExpectedStatus ?? "Not set"}</p>
          </div>
          <div>
            <p className="metric-label">Recent received</p>
            <p>{preview.recentActualStatus ?? "Unknown"}</p>
          </div>
          <div>
            <p className="metric-label">Proposed expected</p>
            <p><strong>{proposed ?? "—"}</strong></p>
          </div>
        </div>

        {preview.riskExplanation ? (
          <div className="http-status-risk-callout">
            <strong>Risk</strong>
            <p>{preview.riskExplanation}</p>
          </div>
        ) : null}

        {preview.recentResults && preview.recentResults.length > 0 ? (
          <div className="http-status-history">
            <p className="metric-label">Recent check history</p>
            <ul>
              {preview.recentResults.map((row, index) => (
                <li key={`${row.checkedAt}-${index}`}>
                  <span className={`result-pill ${row.status === "PASS" ? "pass" : "fail"}`}>{row.status}</span>
                  {" "}
                  HTTP {row.responseCode ?? "—"} — {new Date(row.checkedAt).toLocaleString()}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <form className="stack-form" onSubmit={handleSubmit}>
          <label>
            Approval reason
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Explain why the expected status should change for this environment…"
              rows={3}
              required
            />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={submitting || !proposed}>
              {submitting ? "Applying…" : "Approve and apply"}
            </button>
          </div>
        </form>
        <p className="dashboard-subtle">Incident {incidentId.slice(0, 8)}… • requires authorised approval • not auto-eligible</p>
      </div>
    </div>
  );
}
