import type { Metadata } from "next";
import { Suspense } from "react";
import { resolveMarketingPage } from "../../../content/marketing";
import { MarketingContentPage } from "../../../components/marketing/content-page";
import { ContactForm } from "../../../components/marketing/contact-form";

export async function generateMetadata(): Promise<Metadata> {
  const page = await resolveMarketingPage("contact");
  return {
    title: page?.metaTitle ?? "Contact",
    description: page?.metaDescription
  };
}

export default async function ContactPage() {
  const page = await resolveMarketingPage("contact");
  if (!page) return null;
  const guidance = page.sections.find((section) => section.id === "guidance");

  return (
    <MarketingContentPage
      page={page}
      extras={{
        guidance: (
          <section className="ow-section ow-section--tight">
            <div className="ow-contact-layout">
              <aside className="ow-panel-card">
                <h3>{guidance?.title ?? "What to include"}</h3>
                <p>{guidance?.body}</p>
                {guidance?.note ? <p style={{ marginTop: 14 }}>{guidance.note}</p> : null}
              </aside>
              <Suspense fallback={<div className="ow-contact-form">Loading form…</div>}>
                <ContactForm />
              </Suspense>
            </div>
          </section>
        )
      }}
    />
  );
}
