import Link from "next/link";
import type { ReactNode } from "react";
import type { MarketingCta, MarketingPageContent, MarketingSection } from "../../content/marketing";
import { FeatureCard, type CapabilityState } from "./feature-card";
import { IntelligencePipeline } from "./intelligence-pipeline";
import { CommandCenterPreview } from "./command-center-preview";
import { PageHero, PrimaryCta, SecondaryCta } from "./page-hero";
import { PricingGrid } from "./pricing-grid";

function CtaButton({ cta }: { cta: MarketingCta }) {
  const className =
    cta.variant === "outline"
      ? "ow-btn ow-btn-outline"
      : cta.variant === "secondary"
        ? "ow-btn ow-btn-secondary"
        : cta.variant === "ghost"
          ? "ow-btn ow-btn-ghost"
          : cta.variant === "light"
            ? "ow-btn ow-btn-light"
            : "ow-btn ow-btn-primary";
  return (
    <Link href={cta.href} className={className}>
      {cta.label}
    </Link>
  );
}

function SectionBlock({
  section,
  extras
}: {
  section: MarketingSection;
  extras?: Record<string, ReactNode>;
}) {
  if (extras?.[section.id]) {
    return <>{extras[section.id]}</>;
  }

  const cards = section.cards ?? [];
  const useSolutionStyle = section.cmsKey.includes(".solutions.");
  const usePanelStyle = section.cmsKey.includes(".about.") || !cards.some((card) => card.state);

  const body = (
    <>
      {section.title || section.body ? (
        <div className="ow-section-head">
          {section.eyebrow ? (
            <p className={`ow-eyebrow${section.tone === "band" ? "" : " ow-eyebrow--dark"}`}>
              {section.eyebrow}
            </p>
          ) : null}
          {section.title ? <h2>{section.title}</h2> : null}
          {section.body ? <p>{section.body}</p> : null}
        </div>
      ) : null}

      {section.id === "pipeline" ? <IntelligencePipeline /> : null}

      {cards.length > 0 ? (
        <div className={section.columns === 2 ? "ow-grid-2" : "ow-grid-3"}>
          {cards.map((card) =>
            card.state ? (
              <FeatureCard
                key={card.id}
                title={card.title}
                body={card.body}
                state={card.state as CapabilityState}
                href={card.href}
                icon={card.icon}
              />
            ) : useSolutionStyle ? (
              <article key={card.id} className="ow-solution-card">
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </article>
            ) : (
              <article key={card.id} className="ow-panel-card">
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </article>
            )
          )}
        </div>
      ) : null}

      {section.id === "plans" ? <PricingGrid /> : null}

      {section.note ? <p className="ow-note">{section.note}</p> : null}

      {section.ctas?.length ? (
        <div className="ow-hero-actions" style={{ marginTop: section.title ? 20 : 0 }}>
          {section.ctas.map((cta) => (
            <CtaButton key={`${cta.href}-${cta.label}`} cta={cta} />
          ))}
        </div>
      ) : null}
    </>
  );

  if (section.tone === "band") {
    return (
      <section className="ow-band">
        <div className="ow-section">{body}</div>
      </section>
    );
  }

  if (section.tone === "soft") {
    return (
      <section className="ow-section ow-section--soft">
        {body}
      </section>
    );
  }

  return <section className="ow-section ow-section--tight">{body}</section>;
}

export function MarketingContentPage({
  page,
  extras
}: {
  page: MarketingPageContent;
  extras?: Record<string, ReactNode>;
}) {
  return (
    <>
      <PageHero
        eyebrow={page.hero.eyebrow}
        title={page.hero.title}
        subtitle={page.hero.subtitle}
        actions={
          page.hero.primaryCta || page.hero.secondaryCta ? (
            <>
              {page.hero.primaryCta ? (
                <PrimaryCta href={page.hero.primaryCta.href} label={page.hero.primaryCta.label} />
              ) : null}
              {page.hero.secondaryCta ? (
                <SecondaryCta
                  href={page.hero.secondaryCta.href}
                  label={page.hero.secondaryCta.label}
                />
              ) : null}
            </>
          ) : undefined
        }
        media={
          page.hero.showCommandCenterPreview ? <CommandCenterPreview compact /> : undefined
        }
      />
      {page.sections.map((section) => (
        <SectionBlock key={section.id} section={section} extras={extras} />
      ))}
    </>
  );
}
