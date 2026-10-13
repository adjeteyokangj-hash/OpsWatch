import Link from "next/link";
import type { Metadata } from "next";
import { resolveMarketingPage, type MarketingSection } from "../../content/marketing";
import { CommandCenterPreview } from "../../components/marketing/command-center-preview";
import { FeatureCard, type CapabilityState } from "../../components/marketing/feature-card";
import { HomePricing } from "../../components/marketing/home-pricing";
import {
  IntelligencePipeline,
  MonitoringVisual,
  RecoveryVisual
} from "../../components/marketing/intelligence-pipeline";
import { IntegrationsShowcase } from "../../components/marketing/integrations-showcase";
import { PrimaryCta, SecondaryCta } from "../../components/marketing/page-hero";

function requireSection(pageSections: MarketingSection[], id: string): MarketingSection {
  const found = pageSections.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`Missing home marketing section: ${id}`);
  }
  return found;
}

export async function generateMetadata(): Promise<Metadata> {
  const page = await resolveMarketingPage("home");
  return {
    title: page?.metaTitle ?? "OpsWatch",
    description: page?.metaDescription
  };
}

export default async function HomePage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const previewRaw = params?.cmsPreview;
  const previewToken = typeof previewRaw === "string" ? previewRaw : null;
  const page = await resolveMarketingPage("home", { previewToken });
  if (!page) return null;

  const capabilities = requireSection(page.sections, "capabilities");
  const monitoring = requireSection(page.sections, "monitoring");
  const intelligence = requireSection(page.sections, "intelligence");
  const recovery = requireSection(page.sections, "recovery");
  const integrations = requireSection(page.sections, "integrations");
  const pricing = requireSection(page.sections, "pricing");
  const cta = requireSection(page.sections, "cta");

  return (
    <>
      <section className="ow-home-hero">
        <div className="ow-home-hero-inner">
          <div className="ow-home-hero-copy">
            <p className="ow-eyebrow">{page.hero.eyebrow}</p>
            <h1>{page.hero.title}</h1>
            <p className="ow-lead">{page.hero.subtitle}</p>
            <div className="ow-hero-actions">
              {page.hero.primaryCta ? (
                <PrimaryCta href={page.hero.primaryCta.href} label={page.hero.primaryCta.label} />
              ) : null}
              {page.hero.secondaryCta ? (
                <SecondaryCta
                  href={page.hero.secondaryCta.href}
                  label={page.hero.secondaryCta.label}
                />
              ) : null}
            </div>
            {page.hero.pills?.length ? (
              <div className="ow-hero-meta">
                {page.hero.pills.map((pill, index) => (
                  <span key={pill} className="ow-pill">
                    {index === 0 ? <span className="ow-pill-dot" /> : null}
                    {pill}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="ow-home-hero-media">
            {page.hero.image?.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- CMS absolute URLs
              <img
                className="ow-cms-hero-image"
                src={page.hero.image.url}
                alt={page.hero.image.alt || ""}
              />
            ) : (
              <CommandCenterPreview />
            )}
          </div>
        </div>
      </section>

      <section className="ow-section ow-section--tight">
        <div className="ow-section-head ow-section-head--center">
          <h2>{capabilities.title}</h2>
          <p>{capabilities.body}</p>
        </div>
        <div className="ow-grid-3">
          {(capabilities.cards ?? []).map((card) => (
            <FeatureCard
              key={card.id}
              title={card.title}
              body={card.body}
              state={card.state as CapabilityState}
              href={card.href}
            />
          ))}
        </div>
      </section>

      <section className="ow-section ow-section--split">
        <div className="ow-split-copy">
          <p className="ow-eyebrow ow-eyebrow--dark">{monitoring.eyebrow}</p>
          <h2>{monitoring.title}</h2>
          <p className="ow-lead">{monitoring.body}</p>
          {monitoring.ctas?.[0] ? (
            <Link href={monitoring.ctas[0].href} className="ow-text-link">
              {monitoring.ctas[0].label}
            </Link>
          ) : null}
        </div>
        <MonitoringVisual />
      </section>

      <section className="ow-band">
        <div className="ow-section">
          <div className="ow-section-head ow-section-head--center">
            <p className="ow-eyebrow">{intelligence.eyebrow}</p>
            <h2>{intelligence.title}</h2>
            <p>{intelligence.body}</p>
          </div>
          <IntelligencePipeline />
        </div>
      </section>

      <section className="ow-section ow-section--split ow-section--split-reverse">
        <RecoveryVisual />
        <div className="ow-split-copy">
          <p className="ow-eyebrow ow-eyebrow--dark">{recovery.eyebrow}</p>
          <h2>{recovery.title}</h2>
          <p className="ow-lead">{recovery.body}</p>
          {recovery.ctas?.[0] ? (
            <Link href={recovery.ctas[0].href} className="ow-text-link">
              {recovery.ctas[0].label}
            </Link>
          ) : null}
        </div>
      </section>

      <section className="ow-section ow-section--tight">
        <div className="ow-section-head ow-section-head--center">
          <h2>{integrations.title}</h2>
          <p>{integrations.body}</p>
        </div>
        <IntegrationsShowcase />
      </section>

      <section className="ow-section ow-section--tight ow-section--soft">
        <div className="ow-section-head ow-section-head--center">
          <h2>{pricing.title}</h2>
          <p>{pricing.body}</p>
        </div>
        <HomePricing />
        <div className="ow-section-actions">
          {(pricing.ctas ?? []).map((ctaItem) => (
            <Link
              key={`${ctaItem.href}-${ctaItem.label}`}
              href={ctaItem.href}
              className={
                ctaItem.variant === "primary" ? "ow-btn ow-btn-primary" : "ow-btn ow-btn-outline"
              }
            >
              {ctaItem.label}
            </Link>
          ))}
        </div>
      </section>

      <div className="ow-cta-band">
        <div className="ow-cta-panel">
          <div>
            <h2>{cta.title}</h2>
            <p>{cta.body}</p>
          </div>
          <div className="ow-hero-actions">
            {(cta.ctas ?? []).map((ctaItem) => (
              <Link
                key={`${ctaItem.href}-${ctaItem.label}`}
                href={ctaItem.href}
                className={
                  ctaItem.variant === "secondary"
                    ? "ow-btn ow-btn-secondary"
                    : "ow-btn ow-btn-primary"
                }
              >
                {ctaItem.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
