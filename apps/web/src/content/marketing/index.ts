import { marketingPages } from "./pages";
import { marketingSiteChrome } from "./site";
import { resolveMarketingContent } from "./resolve";

export { getMarketingPage, marketingPages } from "./pages";
export { marketingSiteChrome } from "./site";
export {
  CMS_MODULE_CATALOGUE,
  CMS_MODULE_CODES,
  CMS_PAGE_MODULES,
  CMS_SITE_CHROME_MODULE,
  isCmsModuleCode,
  seedContentForModule,
  validateCmsModulePayload
} from "./contract";
export {
  resolveMarketingChrome,
  resolveMarketingContent,
  resolveMarketingPage
} from "./resolve";
export type {
  MarketingCapabilityState,
  MarketingCard,
  MarketingCta,
  MarketingPageContent,
  MarketingSection,
  MarketingSiteChrome
} from "./types";

/**
 * Sync seed accessor (tests / fallback). Prefer resolveMarketingContent() for pages.
 */
export function getMarketingContent() {
  return {
    chrome: marketingSiteChrome,
    pages: marketingPages
  };
}

/**
 * OkangGroup CMS swap point: published modules override local seed.
 */
export async function getMarketingContentAsync(options?: { previewToken?: string | null }) {
  return resolveMarketingContent(options);
}