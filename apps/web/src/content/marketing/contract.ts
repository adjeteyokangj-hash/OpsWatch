/**
 * Frozen CMS module contract for OkangGroup ↔ OpsWatch integration.
 * Module codes equal cmsKeys. Do not rename without a coordinated migration.
 */
import { marketingPages } from "./pages";
import { marketingSiteChrome } from "./site";
import type { MarketingPageContent, MarketingSiteChrome } from "./types";

export const CMS_SITE_CHROME_MODULE = "opswatch.site.chrome" as const;

export const CMS_PAGE_MODULES = [
  "opswatch.page.home",
  "opswatch.page.platform",
  "opswatch.page.features",
  "opswatch.page.ai-intelligence",
  "opswatch.page.integrations",
  "opswatch.page.solutions",
  "opswatch.page.pricing",
  "opswatch.page.security",
  "opswatch.page.about",
  "opswatch.page.contact"
] as const;

export type CmsPageModuleCode = (typeof CMS_PAGE_MODULES)[number];
export type CmsModuleCode = typeof CMS_SITE_CHROME_MODULE | CmsPageModuleCode;

export const CMS_MODULE_CODES: readonly CmsModuleCode[] = [
  CMS_SITE_CHROME_MODULE,
  ...CMS_PAGE_MODULES
];

export type CmsModuleDescriptor = {
  code: CmsModuleCode;
  kind: "chrome" | "page";
  /** Human label for OkangGroup Managed Websites UI */
  label: string;
  /** Pricing amounts / plan codes are never CMS-owned */
  pricingAmountsEditable: false;
};

export const CMS_MODULE_CATALOGUE: readonly CmsModuleDescriptor[] = [
  {
    code: CMS_SITE_CHROME_MODULE,
    kind: "chrome",
    label: "Site chrome (nav and footer)",
    pricingAmountsEditable: false
  },
  { code: "opswatch.page.home", kind: "page", label: "Homepage", pricingAmountsEditable: false },
  { code: "opswatch.page.platform", kind: "page", label: "Platform", pricingAmountsEditable: false },
  { code: "opswatch.page.features", kind: "page", label: "Features", pricingAmountsEditable: false },
  {
    code: "opswatch.page.ai-intelligence",
    kind: "page",
    label: "AI Intelligence",
    pricingAmountsEditable: false
  },
  {
    code: "opswatch.page.integrations",
    kind: "page",
    label: "Integrations",
    pricingAmountsEditable: false
  },
  { code: "opswatch.page.solutions", kind: "page", label: "Solutions", pricingAmountsEditable: false },
  {
    code: "opswatch.page.pricing",
    kind: "page",
    label: "Pricing (prose only)",
    pricingAmountsEditable: false
  },
  { code: "opswatch.page.security", kind: "page", label: "Security", pricingAmountsEditable: false },
  { code: "opswatch.page.about", kind: "page", label: "About", pricingAmountsEditable: false },
  { code: "opswatch.page.contact", kind: "page", label: "Contact", pricingAmountsEditable: false }
];

export const isCmsModuleCode = (value: string): value is CmsModuleCode =>
  (CMS_MODULE_CODES as readonly string[]).includes(value);

export const seedContentForModule = (code: CmsModuleCode): MarketingSiteChrome | MarketingPageContent => {
  if (code === CMS_SITE_CHROME_MODULE) return marketingSiteChrome;
  const page = Object.values(marketingPages).find((entry) => entry.cmsKey === code);
  if (!page) throw new Error(`No seed content for module ${code}`);
  return page;
};

export const isMarketingSiteChrome = (value: unknown): value is MarketingSiteChrome => {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.cmsKey === CMS_SITE_CHROME_MODULE &&
    typeof row.productBlurb === "string" &&
    Array.isArray(row.nav) &&
    Array.isArray(row.footerCompany)
  );
};

export const isMarketingPageContent = (value: unknown): value is MarketingPageContent => {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.slug === "string" &&
    typeof row.cmsKey === "string" &&
    typeof row.metaTitle === "string" &&
    typeof row.metaDescription === "string" &&
    typeof row.hero === "object" &&
    row.hero != null &&
    Array.isArray(row.sections)
  );
};

export const validateCmsModulePayload = (
  code: CmsModuleCode,
  payload: unknown
): { ok: true } | { ok: false; error: string } => {
  if (code === CMS_SITE_CHROME_MODULE) {
    if (!isMarketingSiteChrome(payload)) {
      return { ok: false, error: "Payload must match MarketingSiteChrome" };
    }
    if (payload.cmsKey !== CMS_SITE_CHROME_MODULE) {
      return { ok: false, error: "cmsKey mismatch for chrome module" };
    }
    return { ok: true };
  }
  if (!isMarketingPageContent(payload)) {
    return { ok: false, error: "Payload must match MarketingPageContent" };
  }
  if (payload.cmsKey !== code) {
    return { ok: false, error: "cmsKey mismatch for page module" };
  }
  return { ok: true };
};
