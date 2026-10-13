import type { Metadata } from "next";
import { Suspense } from "react";
import { ContactForm } from "../../../components/marketing/contact-form";
import { PageHero } from "../../../components/marketing/page-hero";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact OpsWatch for demos, Enterprise pricing, and onboarding questions."
};

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Tell us what you need to monitor"
        subtitle="Ask about demos, Enterprise pricing, security reviews, or onboarding for your application portfolio. We respond by email."
      />

      <section className="ow-section">
        <div className="ow-contact-layout">
          <aside className="ow-panel-card">
            <h3>What to include</h3>
            <p>
              Share the applications you want to watch, whether you need agentless URL checks only,
              and if remediation providers are in scope. For Enterprise, include approximate
              application count and timeline.
            </p>
            <p style={{ marginTop: 14 }}>
              Existing customers can also sign in to the Command Center for billing and operational
              support questions tied to their workspace.
            </p>
          </aside>
          <Suspense fallback={<div className="ow-contact-form">Loading form…</div>}>
            <ContactForm />
          </Suspense>
        </div>
      </section>
    </>
  );
}
