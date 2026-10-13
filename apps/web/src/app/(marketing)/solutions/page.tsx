import type { Metadata } from "next";
import { PageHero, PrimaryCta, SecondaryCta } from "../../../components/marketing/page-hero";

export const metadata: Metadata = {
  title: "Solutions",
  description: "OpsWatch solutions for operations teams, multi-app portfolios, and incident response."
};

export default function SolutionsPage() {
  return (
    <>
      <PageHero
        eyebrow="Solutions"
        title="Operational clarity for teams that run many applications"
        subtitle="OpsWatch helps platform and operations teams watch customer-facing applications, understand dependency impact, and recover with policy controls."
        actions={
          <>
            <PrimaryCta href="/contact" label="Talk to us" />
            <SecondaryCta href="/platform" label="See the platform" />
          </>
        }
      />

      <section className="ow-section">
        <div className="ow-grid-3">
          <article className="ow-solution-card">
            <h3>Operations teams</h3>
            <p>
              Centralize health, alerts, and incidents across applications. Use the Command Center as
              the daily workspace for triage and repair decisions.
            </p>
          </article>
          <article className="ow-solution-card">
            <h3>Multi-application portfolios</h3>
            <p>
              Register each application with its own monitors, topology, and billing plan. Portfolio
              views show which products need attention without mixing tenancy.
            </p>
          </article>
          <article className="ow-solution-card">
            <h3>Incident response</h3>
            <p>
              Move from a failing check to correlated incident context, topology impact, and a
              governed remediation path with verification after the change.
            </p>
          </article>
          <article className="ow-solution-card">
            <h3>Agency and product studios</h3>
            <p>
              Watch client sites and admin surfaces with agentless checks, then invite operators with
              role-based Command Center access.
            </p>
          </article>
          <article className="ow-solution-card">
            <h3>Reliability leads</h3>
            <p>
              Combine check evidence, change events, and automation outcomes to improve recovery
              discipline without claiming unfinished prediction features.
            </p>
          </article>
          <article className="ow-solution-card">
            <h3>Security-minded admins</h3>
            <p>
              Keep credentials encrypted, sessions controlled, and remediation behind policy while
              broader threat analytics continue to mature.
            </p>
          </article>
        </div>
      </section>
    </>
  );
}
