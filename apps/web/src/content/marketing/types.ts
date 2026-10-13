/**
 * OpsWatch public-site content contract for OkangGroup CMS (Phase 1).
 *
 * Editable website copy lives under `content/marketing`.
 * Application business logic (auth, billing, Command Center) stays outside this tree.
 *
 * Future OkangGroup Owner Administration can replace `getMarketingContent()`
 * with a remote fetch without changing page components.
 */

/**
 * Marketing product-truth labels.
 * Keep these distinct from operational connection health:
 * - Available: implemented and selectable; live vendor ops may still be unverified
 * - Live: verified end-to-end product path
 * - Preview / Foundation / Coming soon: incomplete or gated paths
 */
export type MarketingCapabilityState =
  | "Live"
  | "Available"
  | "Preview"
  | "Foundation"
  | "Coming soon";

export type MarketingCta = {
  label: string;
  href: string;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "light";
};

export type MarketingImage = {
  /** Absolute HTTPS URL served to the public site (no private credentials). */
  url: string;
  alt: string;
  /** Optional OkangGroup storage path for Owner re-sign / replace flows. */
  storagePath?: string;
};

export type MarketingCard = {
  id: string;
  title: string;
  body: string;
  state?: MarketingCapabilityState;
  href?: string;
  icon?: string;
};

export type MarketingSection = {
  id: string;
  /** CMS field key for OkangGroup editors */
  cmsKey: string;
  eyebrow?: string;
  title?: string;
  body?: string;
  tone?: "default" | "band" | "soft";
  columns?: 2 | 3;
  cards?: MarketingCard[];
  ctas?: MarketingCta[];
  note?: string;
  /** Optional CMS-managed image (does not replace hardcoded illustration components). */
  image?: MarketingImage;
};

export type MarketingPageContent = {
  slug: string;
  cmsKey: string;
  metaTitle: string;
  metaDescription: string;
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    primaryCta?: MarketingCta;
    secondaryCta?: MarketingCta;
    showCommandCenterPreview?: boolean;
    /** Optional trust pills under the home hero CTAs */
    pills?: string[];
    image?: MarketingImage;
  };
  sections: MarketingSection[];
};

export type MarketingSiteChrome = {
  cmsKey: string;
  productBlurb: string;
  footerNote: string;
  nav: Array<{ href: string; label: string }>;
  footerCompany: Array<{ href: string; label: string }>;
  footerGetStarted: Array<{ href: string; label: string }>;
};
