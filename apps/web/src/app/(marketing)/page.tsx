import Link from "next/link";
import type { Metadata } from "next";
import { CommandCenterPreview } from "../../components/marketing/command-center-preview";
import { FeatureCard } from "../../components/marketing/feature-card";
import { PrimaryCta, SecondaryCta } from "../../components/marketing/page-hero";

export const metadata: Metadata = {
  title: "OpsWatch | Application health and incident remediation",
  description:
    "Monitor application health without agents, understand topology impact, and remediate incidents with governed automation."
};

export default function HomePage() {
  return (
    <>
      <section className="ow-home-hero">
        <div className="ow-home-hero-inner">
          <div>
            <p className="ow-eyebrow">OpsWatch Command Center</p>
            <h1>See application health. Fix what matters.</h1>
            <p className="ow-lead">
              OpsWatch is an agentless application-health and incident-remediation platform with an
              advanced topology foundation. Watch public URLs, services, and dependencies, then act
              with governed repair workflows.
            </p>
            <div className="ow-hero-actions">
              <PrimaryCta href="/register" label="Start monitoring" />
              <SecondaryCta href="/platform" label="Explore the platform" />
            </div>
            <div className="ow-hero-meta">
              <span className="ow-pill">
                <span className="ow-pill-dot" /> Agentless URL and HTTP checks
              </span>
              <span className="ow-pill">Topology-aware incidents</span>
              <span className="ow-pill">Approval-gated remediation</span>
            </div>
          </div>
          <CommandCenterPreview />
        </div>
      </section>

      <section className="ow-section">
        <div className="ow-section-head">
          <h2>Built for operators who need real signal</h2>
          <p>
            OpsWatch focuses on verified monitoring, clear impact, and controlled recovery. Every
            capability below is labelled with its current product state.
          </p>
        </div>
        <div className="ow-grid-3">
          <FeatureCard
            title="Agentless health checks"
            state="Live"
            href="/features"
            body="Register public and admin URLs, run HTTP and SSL checks, and surface health, alerts, and recovery without installing an agent."
          />
          <FeatureCard
            title="Advanced topology"
            state="Live"
            href="/platform"
            body="Understand how services, workflows, and components relate so incidents show blast radius instead of isolated noise."
          />
          <FeatureCard
            title="Governed remediation"
            state="Live"
            href="/ai-intelligence"
            body="Propose repairs, require approval where needed, and execute only registered actions with verification after the change."
          />
        </div>
      </section>

      <section className="ow-band">
        <div className="ow-section ow-band-grid">
          <div>
            <div className="ow-section-head">
              <p className="ow-eyebrow">AI monitoring</p>
              <h2>Intelligence that explains, then assists</h2>
              <p>
                OpsWatch correlates alerts and check failures into incidents, calculates baselines,
                and helps operators decide what to repair. Predictions remain disabled until learning
                evidence is verified.
              </p>
            </div>
            <div className="ow-flow">
              <div className="ow-flow-step">
                <span className="ow-pill-dot" />
                <div>
                  <strong>Detect</strong>
                  <span>Health checks and telemetry feed the operational spine.</span>
                </div>
              </div>
              <div className="ow-flow-step">
                <span className="ow-pill-dot" />
                <div>
                  <strong>Diagnose</strong>
                  <span>AI diagnosis and topology context highlight likely impact paths.</span>
                </div>
              </div>
              <div className="ow-flow-step">
                <span className="ow-pill-dot" />
                <div>
                  <strong>Remediate</strong>
                  <span>Suggested or approved actions run through the safety pipeline.</span>
                </div>
              </div>
            </div>
          </div>
          <div className="ow-illustration">
            <CommandCenterPreview compact />
          </div>
        </div>
      </section>

      <section className="ow-section">
        <div className="ow-section-head">
          <h2>Application monitoring and automated recovery</h2>
          <p>
            Connect applications once, watch the surfaces that matter, and keep recovery under
            operator policy.
          </p>
        </div>
        <div className="ow-grid-2">
          <article className="ow-panel-card">
            <h3>Application monitoring</h3>
            <p>
              Track frontend URLs, APIs, SSL certificates, and connected services. Portfolio views
              show which applications are healthy, degraded, or down.
            </p>
          </article>
          <article className="ow-panel-card">
            <h3>Automated recovery</h3>
            <p>
              Run verified remediation actions such as restart workflows where providers are
              registered. Higher-risk steps stay behind approvals and auto-run policy.
            </p>
          </article>
          <article className="ow-panel-card">
            <h3>Integrations that are ready</h3>
            <p>
              Agentless HTTP and API connections, webhooks, heartbeats, and OpenTelemetry ingest are
              available when configured. Cloud-native connectors stay labelled until verified.
            </p>
          </article>
          <article className="ow-panel-card">
            <h3>Security controls in place</h3>
            <p>
              Platform authentication, encrypted credentials, roles, and audit trails protect the
              Command Center. Broader threat analytics remain a foundation capability.
            </p>
          </article>
        </div>
      </section>

      <section className="ow-section">
        <div className="ow-section-head">
          <h2>Plans that match how OpsWatch bills</h2>
          <p>
            Subscriptions are chosen per application after you sign in. Compare Pilot, Growth,
            Business, and Enterprise on the pricing page.
          </p>
        </div>
        <div className="ow-hero-actions">
          <Link href="/pricing" className="ow-btn ow-btn-primary">
            View pricing
          </Link>
          <Link href="/contact" className="ow-btn ow-btn-light">
            Contact sales
          </Link>
        </div>
      </section>

      <div className="ow-cta-band">
        <div className="ow-cta-panel">
          <div>
            <h2>Open the Command Center when you are ready</h2>
            <p>
              Existing customers sign in to the operational workspace. New teams can register and
              connect their first application URL in minutes.
            </p>
          </div>
          <div className="ow-hero-actions">
            <Link href="/login" className="ow-btn ow-btn-secondary">
              Sign in
            </Link>
            <Link href="/register" className="ow-btn ow-btn-primary">
              Create account
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
