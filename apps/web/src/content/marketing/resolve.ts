import { CMS_SITE_CHROME_MODULE } from "./contract";
import { marketingPages } from "./pages";
import { marketingSiteChrome } from "./site";
import type { MarketingPageContent, MarketingSiteChrome } from "./types";
import { sanitizePageVisualStyles } from "./visualStyle";

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
      const seeded = base.pages[page.slug];
      // Merge CMS overlays onto seed so partial Owner edits (hero-only) cannot
      // drop required homepage sections and crash the public site.
      const cmsSections = Array.isArray(page.sections) ? page.sections : [];
      const seedSections = seeded?.sections ?? [];
      const sectionById = new Map(seedSections.map((section) => [section.id, section]));
      for (const section of cmsSections) {
        if (section?.id) sectionById.set(section.id, section);
      }
      const mergedSections =
        seedSections.length > 0
          ? seedSections.map((seedSection) => sectionById.get(seedSection.id) ?? seedSection)
          : cmsSections;

      const mergedPage: MarketingPageContent = {
        ...(seeded ?? {
          slug: page.slug,
          cmsKey: key,
          metaTitle: "",
          metaDescription: "",
          hero: { eyebrow: "", title: "", subtitle: "" },
          sections: []
        }),
        ...page,
        hero: {
          ...(seeded?.hero ?? { eyebrow: "", title: "", subtitle: "" }),
          ...(page.hero ?? {})
        },
        sections: mergedSections
      };
      pages[page.slug] = sanitizePageVisualStyles(mergedPage);
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

    // no-store so Owner publish/rollback is visible on the next homepage request
    // (ISR revalidate:30 left stale HTML during the Owner CMS journey).
    const response = await fetch(`${apiBase()}/cms/v1/published`, { cache: "no-store" });
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
  const page = content.pages[slug] ?? null;
  return page ? sanitizePageVisualStyles(page) : null;
}

export async function resolveMarketingChrome(options?: {
  previewToken?: string | null;
}): Promise<MarketingSiteChrome> {
  const content = await resolveMarketingContent(options);
  return content.chrome;
}
