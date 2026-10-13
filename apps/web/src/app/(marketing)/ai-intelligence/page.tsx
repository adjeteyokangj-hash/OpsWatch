import type { Metadata } from "next";
import { FeatureCard } from "../../../components/marketing/feature-card";
import { PageHero, PrimaryCta, SecondaryCta } from "../../../components/marketing/page-hero";

export const metadata: Metadata = {
  title: "AI Intelligence",
  description:
    "OpsWatch AI diagnosis, baselines, and automation assist with honest limits on prediction claims."
};

export default function AiIntelligencePage() {
  return (
    <>
      <PageHero
        eyebrow="AI Intelligence"
        title="Explain impact. Assist recovery. Do not invent certainty."
        subtitle="OpsWatch uses AI and calculated intelligence to help operators understand incidents and choose repairs. Predictions are not offered as live product claims while learning remains gated."
        actions={
          <>
            <PrimaryCta href="/register" label="Try Growth features" />
            <SecondaryCta href="/pricing" label="See plan gates" />
          </>
        }
      />

      <section className="ow-section">
        <div className="ow-grid-3">
          <FeatureCard
            title="Incident diagnosis"
            state="Live"
            body="Growth and above can use AI diagnosis over alert, check, and topology evidence to summarise likely impact."
          />
          <FeatureCard
            title="Remediation suggestions"
            state="Live"
            body="Suggested actions stay tied to registered executors and policy. Suggestions are not silent auto-fixes."
          />
          <FeatureCard
            title="Automation planning"
            state="Live"
            body="Playbooks can propose multi-step runs that still pass approvals, maintenance windows, and safety checks."
          />
          <FeatureCard
            title="Learning baselines"
            state="Preview"
            body="Baselines accumulate from check history and readiness thresholds. They orient operators rather than forecast outages."
          />
          <FeatureCard
            title="Operational patterns"
            state="Preview"
            body="Recurring sequences and calculated patterns appear when evidence exists. Heuristics are labelled as calculated."
          />
          <FeatureCard
            title="Predictions"
            state="Coming soon"
            body="Candidate prediction emission remains feature-gated and reports zero live candidates while disabled."
          />
        </div>
      </section>

      <section className="ow-band">
        <div className="ow-section">
          <div className="ow-section-head">
            <h2>Plan access</h2>
            <p>
              AI diagnosis starts on Growth. Autonomous remediation is available on Business and
              Enterprise when policy and provider capability allow it. Pilot includes suggested
              remediation without AI diagnosis.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
