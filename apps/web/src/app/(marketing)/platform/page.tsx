import type { Metadata } from "next";
import { CommandCenterPreview } from "../../../components/marketing/command-center-preview";
import { FeatureCard } from "../../../components/marketing/feature-card";
import { PageHero, PrimaryCta, SecondaryCta } from "../../../components/marketing/page-hero";

export const metadata: Metadata = {
  title: "Platform",
  description:
    "Explore the OpsWatch platform: agentless health, topology, incidents, and governed remediation."
};

export default function PlatformPage() {
  return (
    <>
      <PageHero
        eyebrow="Platform"
        title="One operational spine for health, impact, and repair"
        subtitle="OpsWatch connects monitoring evidence to topology context and remediation workflows so operators can move from detection to recovery without switching tools."
        actions={
          <>
            <PrimaryCta href="/register" />
            <SecondaryCta href="/features" label="Browse features" />
          </>
        }
        media={<CommandCenterPreview compact />}
      />

      <section className="ow-section">
        <div className="ow-grid-3">
          <FeatureCard
            title="URL-first onboarding"
            state="Live"
            body="Create persistent public or admin URL connections and provision HTTP and SSL checks directly from application onboarding."
          />
          <FeatureCard
            title="Canonical topology"
            state="Live"
            body="Entities and relationships stay on one model so dashboards, incidents, and automation share the same dependency view."
          />
          <FeatureCard
            title="Incident correlation"
            state="Live"
            body="Related alerts and check failures roll into incidents with ownership, severity, and recovery tracking."
          />
          <FeatureCard
            title="OpenTelemetry bridge"
            state="Live"
            body="Normalized OTEL signals enrich the operational spine for alerts, incidents, and topology freshness."
          />
          <FeatureCard
            title="Automation playbooks"
            state="Live"
            body="Plan multi-step repairs through the existing safety pipeline, with approvals and verification where required."
          />
          <FeatureCard
            title="Logs and APM search"
            state="Foundation"
            body="Request latency, throughput, and searchable logs are building on the observability foundation and are not claimed as complete APM."
          />
        </div>
      </section>

      <section className="ow-band">
        <div className="ow-section">
          <div className="ow-section-head">
            <h2>What the Command Center is for</h2>
            <p>
              After you sign in, the Command Center is the authenticated workspace for dashboards,
              applications, incidents, connections, automation, and billing. The public site explains
              the product. The Command Center runs it.
            </p>
          </div>
          <div className="ow-hero-actions">
            <PrimaryCta href="/login" label="Sign in to Command Center" />
            <SecondaryCta href="/pricing" label="Compare plans" />
          </div>
        </div>
      </section>
    </>
  );
}
