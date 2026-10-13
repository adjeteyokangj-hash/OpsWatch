import { CMS_SITE_CHROME_MODULE } from "./contract";
import { marketingPages } from "./pages";
import { marketingSiteChrome } from "./site";
import type { MarketingPageContent, MarketingSiteChrome } from "./types";

const apiBase = () =>
  (process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    process.env.OPSWATCH_API_URL ||
    "http://localhost:4000/api").replace(/\/$/, "");

export type ResolvedMarketingContent = {
  chrome: MarketingSiteChrome;
  pages: Record<string, MarketingPageContent>;
  source: "published" | "preview" | "seed";
};

const clonePages = (): Record<string, MarketingPageContent> =>
  structuredClone(marketingPages);

const mergeModules = (
  modules: Record<string, unknown>,
  base: ResolvedMarketingContent
): ResolvedMarketingContent => {
  const pages = { ...base.pages };
  let chrome = base.chrome;
  for (const [key, value] of Object.entries(modules)) {
    if (key === CMS_SITE_CHROME_MODULE && value && typeof value === "object") {
      chrome = value as MarketingSiteChrome;
      continue;
    }
    if (key.startsWith("opswatch.page.") && value && typeof value === "object") {
      const page = value as MarketingPageContent;
      pages[page.slug] = page;
    }
  }
  return { chrome, pages, source: base.source };
};

export async function resolveMarketingContent(options?: {
  previewToken?: string | null;
}): Promise<ResolvedMarketingContent> {
  const seed: ResolvedMarketingContent = {
    chrome: marketingSiteChrome,
    pages: clonePages(),
    source: "seed"
  };

  try {
    if (options?.previewToken) {
      const response = await fetch(
        `${apiBase()}/cms/v1/preview?token=${encodeURIComponent(options.previewToken)}`,
        { cache: "no-store" }
      );
      if (response.ok) {
        const payload = (await response.json()) as { modules?: Record<string, unknown> };
        return mergeModules(payload.modules ?? {}, { ...seed, source: "preview" });
      }
    }

    const response = await fetch(`${apiBase()}/cms/v1/published`, { next: { revalidate: 30 } });
    if (!response.ok) return seed;
    const payload = (await response.json()) as { modules?: Record<string, unknown> };
    const modules = payload.modules ?? {};
    if (Object.keys(modules).length === 0) return seed;
    return mergeModules(modules, { ...seed, source: "published" });
  } catch {
    return seed;
  }
}

export async function resolveMarketingPage(
  slug: string,
  options?: { previewToken?: string | null }
): Promise<MarketingPageContent | null> {
  const content = await resolveMarketingContent(options);
  return content.pages[slug] ?? null;
}

export async function resolveMarketingChrome(options?: {
  previewToken?: string | null;
}): Promise<MarketingSiteChrome> {
  const content = await resolveMarketingContent(options);
  return content.chrome;
}
