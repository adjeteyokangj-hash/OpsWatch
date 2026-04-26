"use client";

import { useEffect, useState } from "react";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { apiFetch } from "../../lib/api";

type OnboardingState = {
  completedSteps: string[];
  totalSteps: number;
  steps: string[];
  percentComplete: number;
  isComplete: boolean;
};

const STEP_META: Record<string, { label: string; description: string; action?: string; href?: string }> = {
  org_created:           { label: "Create your organization",       description: "Set up your OpsWatch workspace with a name and slug.",          href: "/org" },
  plan_selected:         { label: "Choose a plan",                  description: "Select the plan that fits your team size and usage.",            href: "/billing" },
  project_created:       { label: "Create your first project",      description: "Add a client project you want to monitor.",                     href: "/projects" },
  service_created:       { label: "Add a service",                  description: "Define a service within your project (API, frontend, DB…).",    href: "/projects" },
  check_created:         { label: "Create a check",                 description: "Set up an HTTP, SSL, keyword, or response-time check.",         href: "/checks" },
  notification_configured: { label: "Configure notifications",     description: "Add an email or webhook channel to receive alerts.",            href: "/settings" },
  status_page_created:   { label: "Publish a status page",         description: "Create a public status page for your clients.",                 href: "/org" },
  team_invited:          { label: "Invite your team",              description: "Add teammates so your whole team can monitor and respond.",      href: "/users" }
};

export default function OnboardingPage() {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<OnboardingState>("/onboarding/progress");
      setState(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load onboarding progress");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const markComplete = async (step: string) => {
    try {
      await apiFetch(`/onboarding/complete/${step}`, { method: "POST" });
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to mark step complete");
    }
  };

  const markIncomplete = async (step: string) => {
    try {
      await apiFetch(`/onboarding/complete/${step}`, { method: "DELETE" });
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to update step");
    }
  };

  return (
    <Shell>
      <Header title="Getting started" />
      {error ? <section className="panel error-panel">{error}</section> : null}

      {loading ? (
        <p>Loading onboarding...</p>
      ) : state ? (
        <>
          <section className="panel onboarding-header">
            <div className="onboarding-progress-label">
              {state.isComplete ? (
                <strong>Setup complete!</strong>
              ) : (
                <strong>{state.percentComplete}% complete — {state.completedSteps.length}/{state.totalSteps} steps done</strong>
              )}
            </div>
            <div className="onboarding-bar-track">
              <div className="onboarding-bar-fill" style={{ width: `${state.percentComplete}%` }} />
            </div>
          </section>

          <section className="onboarding-steps">
            {state.steps.map((step, idx) => {
              const isComplete = state.completedSteps.includes(step);
              const meta = STEP_META[step] || { label: step, description: "" };
              return (
                <div key={step} className={`onboarding-step${isComplete ? " onboarding-step--done" : ""}`}>
                  <div className="onboarding-step-number">{isComplete ? "✓" : idx + 1}</div>
                  <div className="onboarding-step-body">
                    <strong>{meta.label}</strong>
                    <p>{meta.description}</p>
                    <div className="onboarding-step-actions">
                      {meta.href ? (
                        <a href={meta.href} className="primary-button onboarding-link">
                          {isComplete ? "Review →" : "Go →"}
                        </a>
                      ) : null}
                      {!isComplete ? (
                        <button className="secondary-button" onClick={() => void markComplete(step)}>
                          Mark complete
                        </button>
                      ) : (
                        <button className="secondary-button" onClick={() => void markIncomplete(step)}>
                          Undo
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        </>
      ) : null}
    </Shell>
  );
}
