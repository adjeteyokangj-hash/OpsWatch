import { marketingPages } from "./pages";
import { marketingSiteChrome } from "./site";

export { getMarketingPage, marketingPages } from "./pages";
export { marketingSiteChrome } from "./site";
export type {
  MarketingCapabilityState,
  MarketingCard,
  MarketingCta,
  MarketingPageContent,
  MarketingSection,
  MarketingSiteChrome
} from "./types";

/**
 * Single entry for OkangGroup CMS Phase 1: swap this implementation to fetch
 * remote content without changing marketing page components.
 */
export function getMarketingContent() {
  return {
    chrome: marketingSiteChrome,
    pages: marketingPages
  };
}
