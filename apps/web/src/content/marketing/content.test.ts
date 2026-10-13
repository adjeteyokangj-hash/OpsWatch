import { describe, expect, it } from "vitest";
import {
  CMS_MODULE_CATALOGUE,
  CMS_MODULE_CODES,
  CMS_SITE_CHROME_MODULE,
  getMarketingPage,
  marketingPages,
  marketingSiteChrome,
  seedContentForModule,
  validateCmsModulePayload
} from "./index";

const OBSERVABILITY_TITLE = "Advanced Observability Integrations";

const collectText = (): string[] => {
  const chunks: string[] = [marketingSiteChrome.productBlurb, marketingSiteChrome.footerNote];
  for (const page of Object.values(marketingPages)) {
    chunks.push(page.metaTitle, page.metaDescription, page.hero.eyebrow, page.hero.title, page.hero.subtitle);
    if (page.hero.pills) chunks.push(...page.hero.pills);
    for (const cta of [page.hero.primaryCta, page.hero.secondaryCta]) {
      if (cta?.label) chunks.push(cta.label);
    }
    for (const section of page.sections) {
      if (section.eyebrow) chunks.push(section.eyebrow);
      if (section.title) chunks.push(section.title);
      if (section.body) chunks.push(section.body);
      if (section.note) chunks.push(section.note);
      for (const card of section.cards ?? []) {
        chunks.push(card.title, card.body);
        if (card.state) chunks.push(card.state);
      }
      for (const cta of section.ctas ?? []) {
        chunks.push(cta.label);
      }
    }
  }
  return chunks;
};

const observabilityCards = () =>
  Object.values(marketingPages).flatMap((page) =>
    (page.sections ?? []).flatMap((section) =>
      (section.cards ?? []).filter((card) => card.title === OBSERVABILITY_TITLE)
    )
  );

describe("marketing content", () => {
  it("exposes every public page slug", () => {
    for (const slug of [
      "home",
      "platform",
      "features",
      "ai-intelligence",
      "integrations",
      "solutions",
      "pricing",
      "security",
      "about",
      "contact"
    ]) {
      expect(getMarketingPage(slug)?.slug).toBe(slug);
      expect(getMarketingPage(slug)?.cmsKey).toContain("opswatch.page.");
    }
  });

  it("keeps chrome and page cms keys namespaced for OkangGroup", () => {
    expect(marketingSiteChrome.cmsKey).toBe("opswatch.site.chrome");
    expect(marketingSiteChrome.nav.length).toBeGreaterThanOrEqual(6);
    expect(Object.keys(marketingPages)).toHaveLength(10);
  });

  it("avoids em dashes and decorative dash separators in user-facing copy", () => {
    for (const text of collectText()) {
      expect(text).not.toMatch(/[—–]/);
      expect(text).not.toMatch(/\s-\s/);
    }
  });

  it("keeps Advanced Observability Integrations as Available, not Live", () => {
    const cards = observabilityCards();
    expect(cards.length).toBeGreaterThanOrEqual(2);
    for (const card of cards) {
      expect(card.state).toBe("Available");
      expect(card.state).not.toBe("Live");
      expect(card.body).toContain(
        "Connect supported monitoring and telemetry sources to bring application health, performance signals and dependency information into OpsWatch."
      );
    }
  });

  it("preserves provider-neutral branding on public marketing pages", () => {
    for (const text of collectText()) {
      expect(text).not.toMatch(/datadog|dynatrace/i);
    }
  });

  it("freezes CMS module catalogue against seed content keys", () => {
    expect(CMS_MODULE_CODES).toContain(CMS_SITE_CHROME_MODULE);
    expect(CMS_MODULE_CATALOGUE).toHaveLength(CMS_MODULE_CODES.length);
    for (const module of CMS_MODULE_CATALOGUE) {
      expect(module.pricingAmountsEditable).toBe(false);
      const seed = seedContentForModule(module.code);
      expect(validateCmsModulePayload(module.code, seed)).toEqual({ ok: true });
    }
    for (const page of Object.values(marketingPages)) {
      expect(CMS_MODULE_CODES).toContain(page.cmsKey);
    }
    expect(marketingSiteChrome.cmsKey).toBe(CMS_SITE_CHROME_MODULE);
  });
});
