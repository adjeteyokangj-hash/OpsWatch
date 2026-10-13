import type { Metadata } from "next";
import { PricingGrid } from "../../../components/marketing/pricing-grid";
import { PageHero, PrimaryCta, SecondaryCta } from "../../../components/marketing/page-hero";

export const metadata: Metadata = {
  title: "Pricing",
  description: "OpsWatch plans: Pilot, Growth, Business, and Enterprise. Billed per application."
};

export default function PricingPage() {
  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Straightforward plans. Billed per application."
        subtitle="Choose a plan for each application in the Command Center Billing tab. Stripe checkout and the customer portal are available when platform Stripe is connected."
        actions={
          <>
            <PrimaryCta href="/register" label="Create account" />
            <SecondaryCta href="/contact?topic=enterprise" label="Enterprise enquiry" />
          </>
        }
      />

      <section className="ow-section">
        <PricingGrid />
        <p className="ow-note">
          After sign-in, open an application and use Billing to select Pilot, Growth, Business, or a
          custom Enterprise arrangement. Workspace-wide subscriptions are not used. An optional
          Cloudflare backup add-on is not available yet and is not included in these prices.
        </p>
      </section>
    </>
  );
}
