import type { Metadata } from "next";
import { FeatureCard } from "../../../components/marketing/feature-card";
import { PageHero, PrimaryCta, SecondaryCta } from "../../../components/marketing/page-hero";

export const metadata: Metadata = {
  title: "Features",
  description: "OpsWatch features with honest Live, Preview, and Foundation labels."
};

export default function FeaturesPage() {
  return (
    <>
      <PageHero
        eyebrow="Features"
        title="Capabilities labelled by verification state"
        subtitle="We show what is live, what is preview, and what is still foundation work. Unfinished surfaces are never presented as production monitoring."
        actions={
          <>
            <PrimaryCta href="/register" />
            <SecondaryCta href="/integrations" label="See integrations" />
          </>
        }
      />

      <section className="ow-section">
        <div className="ow-section-head">
          <h2>Live verified</h2>
          <p>Persisted runtime paths exercised by monitoring, incidents, and remediation.</p>
        </div>
        <div className="ow-grid-3">
          <FeatureCard
            title="HTTP, SSL, and keyword checks"
            state="Live"
            body="Worker-executed checks store results, drive health, raise alerts, and support recovery evidence."
          />
          <FeatureCard
            title="Application portfolio health"
            state="Live"
            body="See healthy, degraded, and down applications with last signal timing and check outcomes."
          />
          <FeatureCard
            title="Topology and dependency impact"
            state="Live"
            body="Canonical entities and relationships show how failures propagate across modules and workflows."
          />
          <FeatureCard
            title="Incidents and alerts"
            state="Live"
            body="Operational records stay linked to projects, services, and remediation actions."
          />
          <FeatureCard
            title="Suggested and approved remediation"
            state="Live"
            body="Registered executors can repair when policy allows. Unsupported catalogue actions stay planning-only."
          />
          <FeatureCard
            title="Per-application billing"
            state="Live"
            body="Choose Pilot, Growth, Business, or Enterprise per application and check out through Stripe when configured."
          />
        </div>
      </section>

      <section className="ow-section">
        <div className="ow-section-head">
          <h2>Preview and foundation</h2>
          <p>Useful paths that are incomplete, gated, or still collecting evidence.</p>
        </div>
        <div className="ow-grid-3">
          <FeatureCard
            title="Intelligence baselines and patterns"
            state="Preview"
            body="Calculated baselines and operational patterns help orientation. They are not marketed as autonomous prediction."
          />
          <FeatureCard
            title="Synthetic journeys"
            state="Preview"
            body="Journey drafts can be stored, but execution is not enabled. Drafts never count as active monitoring."
          />
          <FeatureCard
            title="Predictions"
            state="Coming soon"
            body="Prediction emission stays disabled until learning evidence and feedback loops are verified."
          />
          <FeatureCard
            title="Searchable logs and APM"
            state="Foundation"
            body="Telemetry foundations exist. Full searchable log and APM product depth is still expanding."
          />
          <FeatureCard
            title="Security threat analytics"
            state="Foundation"
            body="Auth, credentials, roles, and audit are live. Broader detection analytics remain foundation work."
          />
          <FeatureCard
            title="Native Datadog and Dynatrace connectors"
            state="Coming soon"
            body="Native connectors wait until generic synchronization and observability foundations are complete."
          />
        </div>
      </section>
    </>
  );
}
