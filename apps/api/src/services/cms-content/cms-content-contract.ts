/**
 * Mirror of apps/web marketing CMS module contract.
 * Keep in sync with apps/web/src/content/marketing/contract.ts
 */
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

export const CMS_MODULE_CATALOGUE = [
  { code: CMS_SITE_CHROME_MODULE, kind: "chrome" as const, label: "Site chrome (nav and footer)" },
  { code: "opswatch.page.home", kind: "page" as const, label: "Homepage" },
  { code: "opswatch.page.platform", kind: "page" as const, label: "Platform" },
  { code: "opswatch.page.features", kind: "page" as const, label: "Features" },
  { code: "opswatch.page.ai-intelligence", kind: "page" as const, label: "AI Intelligence" },
  { code: "opswatch.page.integrations", kind: "page" as const, label: "Integrations" },
  { code: "opswatch.page.solutions", kind: "page" as const, label: "Solutions" },
  { code: "opswatch.page.pricing", kind: "page" as const, label: "Pricing (prose only)" },
  { code: "opswatch.page.security", kind: "page" as const, label: "Security" },
  { code: "opswatch.page.about", kind: "page" as const, label: "About" },
  { code: "opswatch.page.contact", kind: "page" as const, label: "Contact" }
] as const;

export const isCmsModuleCode = (value: string): value is CmsModuleCode =>
  (CMS_MODULE_CODES as readonly string[]).includes(value);

/** Fields that must never be accepted from CMS for billing truth. */
export const CMS_FORBIDDEN_BILLING_KEYS = [
  "monthlyPrice",
  "annualPrice",
  "stripePriceId",
  "stripeProductId",
  "entitlements",
  "planCode",
  "PLAN_DEFINITIONS"
] as const;

export const assertNoBillingFields = (
  payload: unknown
): { ok: true } | { ok: false; error: string } => {
  const raw = JSON.stringify(payload ?? {});
  for (const key of CMS_FORBIDDEN_BILLING_KEYS) {
    if (raw.includes(`"${key}"`)) {
      return {
        ok: false,
        error: `CMS payload must not include billing field "${key}". Pricing amounts stay outside CMS.`
      };
    }
  }
  return { ok: true };
};

export const isChromePayload = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.cmsKey === CMS_SITE_CHROME_MODULE &&
    typeof row.productBlurb === "string" &&
    Array.isArray(row.nav)
  );
};

export const isPagePayload = (code: CmsModuleCode, value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.cmsKey === code &&
    typeof row.slug === "string" &&
    typeof row.metaTitle === "string" &&
    typeof row.hero === "object" &&
    Array.isArray(row.sections)
  );
};

export const validateCmsModulePayload = (
  code: CmsModuleCode,
  payload: unknown
): { ok: true } | { ok: false; error: string } => {
  const billing = assertNoBillingFields(payload);
  if (!billing.ok) return billing;
  if (code === CMS_SITE_CHROME_MODULE) {
    return isChromePayload(payload)
      ? { ok: true }
      : { ok: false, error: "Payload must match MarketingSiteChrome" };
  }
  return isPagePayload(code, payload)
    ? { ok: true }
    : { ok: false, error: "Payload must match MarketingPageContent" };
};
