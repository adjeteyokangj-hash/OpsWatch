import type { Metadata } from "next";
import { FeatureCard } from "../../../components/marketing/feature-card";
import { PageHero, PrimaryCta, SecondaryCta } from "../../../components/marketing/page-hero";

export const metadata: Metadata = {
  title: "Security",
  description:
    "OpsWatch security controls for authentication, credentials, roles, audit, and governed remediation."
};

export default function SecurityMarketingPage() {
  return (
    <>
      <PageHero
        eyebrow="Security"
        title="Protect the control plane while operations stay honest"
        subtitle="OpsWatch secures sign-in, secrets, roles, and remediation boundaries. Broader threat detection analytics are foundation work and are not sold as a finished security operations centre."
        actions={
          <>
            <PrimaryCta href="/contact" label="Ask about security" />
            <SecondaryCta href="/features" label="Review capabilities" />
          </>
        }
      />

      <section className="ow-section">
        <div className="ow-grid-3">
          <FeatureCard
            title="Authentication and sessions"
            state="Live"
            body="HttpOnly session cookies, CSRF protection, and session expiry protect Command Center access."
          />
          <FeatureCard
            title="Encrypted credentials"
            state="Live"
            body="Webhook, OpenTelemetry, and connection secrets use managed encrypted storage with rotation paths."
          />
          <FeatureCard
            title="Roles and membership"
            state="Live"
            body="Organization roles control who can administer projects, members, billing, and automation policy."
          />
          <FeatureCard
            title="Governed remediation"
            state="Live"
            body="Approvals, auto-run policy, maintenance windows, and registered executors bound what can run."
          />
          <FeatureCard
            title="Audit and evidence"
            state="Live"
            body="Operational actions and security-relevant changes leave persisted evidence for review."
          />
          <FeatureCard
            title="Threat analytics workspace"
            state="Foundation"
            body="Deterministic findings foundations exist. Do not treat the security workspace as complete SOC analytics."
          />
        </div>
      </section>
    </>
  );
}
