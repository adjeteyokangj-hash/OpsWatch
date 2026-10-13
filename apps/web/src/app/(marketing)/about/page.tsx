import type { Metadata } from "next";
import { PageHero, PrimaryCta, SecondaryCta } from "../../../components/marketing/page-hero";

export const metadata: Metadata = {
  title: "About",
  description: "About OpsWatch, an Okang Group platform for application health and remediation."
};

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About OpsWatch"
        title="Built for teams that need trustworthy operations software"
        subtitle="OpsWatch is an Okang Group platform focused on agentless application health, topology-aware incidents, and governed remediation. We prioritize verified capability over marketing theatre."
        actions={
          <>
            <PrimaryCta href="/contact" label="Contact us" />
            <SecondaryCta href="/platform" label="Explore the platform" />
          </>
        }
      />

      <section className="ow-section">
        <div className="ow-grid-2">
          <article className="ow-panel-card">
            <h3>Product position</h3>
            <p>
              OpsWatch is an agentless application-health and incident-remediation platform with an
              advanced topology foundation. It is not positioned as a Datadog-class or Dynatrace-class
              suite.
            </p>
          </article>
          <article className="ow-panel-card">
            <h3>How we ship</h3>
            <p>
              Features graduate through verified runtime evidence. Placeholders, seeded demos, and
              unfinished connectors are labelled honestly on this website and inside the product.
            </p>
          </article>
          <article className="ow-panel-card">
            <h3>Who it is for</h3>
            <p>
              Operations teams, product studios, and platform owners who need clear health across
              customer applications and a controlled path to repair.
            </p>
          </article>
          <article className="ow-panel-card">
            <h3>Okang Group</h3>
            <p>
              OpsWatch is developed within Okang Group alongside other production applications that
              rely on the same operational standards we expose to customers.
            </p>
          </article>
        </div>
      </section>
    </>
  );
}
