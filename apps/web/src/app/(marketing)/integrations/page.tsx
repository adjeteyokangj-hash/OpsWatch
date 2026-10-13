import type { Metadata } from "next";
import { FeatureCard } from "../../../components/marketing/feature-card";
import { PageHero, PrimaryCta, SecondaryCta } from "../../../components/marketing/page-hero";

export const metadata: Metadata = {
  title: "Integrations",
  description:
    "OpsWatch connection modes that are available today, plus preview connectors that are not yet live monitoring."
};

export default function IntegrationsMarketingPage() {
  return (
    <>
      <PageHero
        eyebrow="Integrations"
        title="Connect the surfaces you can actually monitor"
        subtitle="Available modes create real monitoring evidence. Preview and planned connectors are labelled clearly so teams do not confuse a catalogue entry with a live path."
        actions={
          <>
            <PrimaryCta href="/register" />
            <SecondaryCta href="/login" label="Open Command Center" />
          </>
        }
      />

      <section className="ow-section">
        <div className="ow-section-head">
          <h2>Available now</h2>
          <p>Complete runtime paths when configuration requirements are met.</p>
        </div>
        <div className="ow-grid-3">
          <FeatureCard
            title="Agentless HTTP and API"
            state="Live"
            body="Probe public endpoints, validate responses, and keep health current without installing an agent."
          />
          <FeatureCard
            title="Heartbeat ingest"
            state="Live"
            body="Applications can sign and send heartbeats so OpsWatch detects silence and recovery."
          />
          <FeatureCard
            title="Webhooks"
            state="Live"
            body="Receive signed events into the operational spine for alerts and change correlation."
          />
          <FeatureCard
            title="OpenTelemetry"
            state="Live"
            body="Ingest normalized OTEL batches that enrich alerts, incidents, and topology freshness."
          />
          <FeatureCard
            title="SDK and signed ingest"
            state="Live"
            body="Client packages and signed project credentials support controlled application reporting."
          />
          <FeatureCard
            title="Worker remediator hooks"
            state="Live"
            body="Register provider capabilities for verified repair actions your application can actually execute."
          />
        </div>
      </section>

      <section className="ow-section">
        <div className="ow-section-head">
          <h2>Preview or planned</h2>
          <p>Visible in catalogues for evaluation, not sold as finished monitoring.</p>
        </div>
        <div className="ow-grid-3">
          <FeatureCard
            title="Synthetic browser journeys"
            state="Preview"
            body="Draft definitions can be stored. Ordered execution, screenshots, and journey alerts are not enabled."
          />
          <FeatureCard
            title="Cloud database connectors"
            state="Coming soon"
            body="Manifest entries may appear for planning, but they cannot be started as live monitoring yet."
          />
          <FeatureCard
            title="Native Datadog and Dynatrace"
            state="Coming soon"
            body="Native vendor connectors wait until generic sync, secrets, and observability foundations are complete."
          />
          <FeatureCard
            title="Cloudflare backup add-on"
            state="Coming soon"
            body="An optional paid Cloudflare backup service is not implemented in the product today and is not offered as live."
          />
        </div>
      </section>
    </>
  );
}
