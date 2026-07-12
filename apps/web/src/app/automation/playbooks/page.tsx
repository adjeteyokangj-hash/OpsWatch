"use client";

import { useEffect, useState } from "react";
import { Shell } from "../../../components/layout/shell";
import { Header } from "../../../components/layout/header";
import { apiFetch } from "../../../lib/api";

type PlaybookVersion = {
  id: string;
  version: number;
  status: string;
  reviewReason: string | null;
  steps: Array<{ stepOrder: number; action: string; description: string; approvalRequired: boolean }>;
};

type Playbook = {
  key: string;
  name: string;
  description: string;
  riskLevel: string;
  latestApprovedVersion: number | null;
  versions: PlaybookVersion[];
};

export default function PlaybooksGovernancePage() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewReason, setReviewReason] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const rows = await apiFetch<Playbook[]>("/automation/playbooks/governance");
      setPlaybooks(rows);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load playbooks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submitVersion = async (playbookKey: string, version: number) => {
    await apiFetch(`/automation/playbooks/${playbookKey}/versions/${version}/submit`, {
      method: "POST",
      body: "{}"
    });
    await load();
  };

  const reviewVersion = async (playbookKey: string, version: number, decision: "APPROVED" | "REJECTED") => {
    const reason = reviewReason[`${playbookKey}:${version}`]?.trim();
    if (!reason) {
      setError("Review reason is required");
      return;
    }
    await apiFetch(`/automation/playbooks/${playbookKey}/versions/${version}/review`, {
      method: "POST",
      body: JSON.stringify({ decision, reason })
    });
    await load();
  };

  return (
    <Shell>
      <Header title="Playbook Governance" />
      <section className="panel">
        <p className="dashboard-subtle">
          Playbook approval is separate from run approval. Only the latest <strong>APPROVED</strong> version is used by
          the automation planner.
        </p>
      </section>
      {error ? <section className="panel error-panel">{error}</section> : null}
      {loading ? (
        <section className="panel">Loading playbooks…</section>
      ) : (
        <div className="hub-card-grid">
          {playbooks.map((playbook) => (
            <section className="panel playbook-card" key={playbook.key}>
              <h2>
                {playbook.name} <span className="table-subtle">({playbook.key})</span>
              </h2>
              <p className="dashboard-subtle">
                {playbook.description} · Risk {playbook.riskLevel} · Approved v{playbook.latestApprovedVersion ?? "—"}
              </p>
              {playbook.versions.map((version) => (
              <article className="playbook-version-card" key={version.id}>
                <div className="playbook-version-head">
                  <strong>v{version.version}</strong>
                  <span className={`status-pill status-${version.status.toLowerCase().replace("_", "-")}`}>
                    {version.status}
                  </span>
                </div>
                <ol>
                  {version.steps.map((step) => (
                    <li key={step.stepOrder}>
                      {step.action}
                      {step.approvalRequired ? " (approval required)" : ""} — {step.description}
                    </li>
                  ))}
                </ol>
                {version.reviewReason ? <p className="table-subtle">Review: {version.reviewReason}</p> : null}
                <div className="channel-actions">
                  {version.status === "DRAFT" || version.status === "REJECTED" ? (
                    <button type="button" className="btn ghost" onClick={() => void submitVersion(playbook.key, version.version)}>
                      Submit for review
                    </button>
                  ) : null}
                  {version.status === "IN_REVIEW" ? (
                    <>
                      <input
                        placeholder="Review reason"
                        value={reviewReason[`${playbook.key}:${version.version}`] ?? ""}
                        onChange={(event) =>
                          setReviewReason((current) => ({
                            ...current,
                            [`${playbook.key}:${version.version}`]: event.target.value
                          }))
                        }
                      />
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => void reviewVersion(playbook.key, version.version, "APPROVED")}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => void reviewVersion(playbook.key, version.version, "REJECTED")}
                      >
                        Reject
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            ))}
            </section>
          ))}
        </div>
      )}
    </Shell>
  );
}
